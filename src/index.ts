import fs from 'fs/promises';
import path from 'path';
import * as z from 'zod';
import { launchCheck, tryApplyTrait } from '@uems/micro-builder/build/src';
import { RabbitNetworkHandler } from '@uems/micro-builder/build/src/messaging/GenericRabbitNetworkHandler';
import { _ml } from './logging/Log';
import { Database, MongoDBConfigurationSchema } from './database/Database';
import bind from './binding/VenueDatabaseBinding';
import {
    DiscoveryMessage, DiscoveryResponse,
    DiscoveryResponseValidator, DiscoveryMessageValidator,
    has,
    VenueMessage as VM,
    VenueMessageValidator,
    VenueResponse as VR,
    VenueResponseValidator,
} from '@uems/uemscommlib';
import { MessagingConfigurationSchema } from './networking/Messaging';

const __ = _ml(__filename);
const _b = _ml(`${__filename} | bind`);

__.info('starting tartarus...');

void launchCheck(['successful', 'errored', 'rabbitmq', 'database', 'config'], (traits: Record<string, any>) => {
    if (has(traits, 'rabbitmq') && traits.rabbitmq !== '_undefined' && !traits.rabbitmq) return 'unhealthy';
    if (has(traits, 'database') && traits.database !== '_undefined' && !traits.database) return 'unhealthy';
    if (has(traits, 'config') && traits.config !== '_undefined' && !traits.config) return 'unhealthy';

    // If 75% of results fail then we return false
    if (has(traits, 'successful') && has(traits, 'errored')) {
        const errorPercentage = traits.errored / (traits.successful + traits.errored);
        if (errorPercentage > 0.05) return 'unhealthy-serving';
    }

    return 'healthy';
});

const ConfigurationSchema = z.object({
    message: MessagingConfigurationSchema,
    database: MongoDBConfigurationSchema,
});

export type VenueRabbitNetworkHandler = RabbitNetworkHandler<VM.VenueMessage | DiscoveryMessage.DiscoveryDeleteMessage,
    VM.CreateVenueMessage,
    VM.DeleteVenueMessage,
    VM.ReadVenueMessage | DiscoveryMessage.DiscoveryDeleteMessage,
    VM.UpdateVenueMessage,
// @ts-ignore
    VR.VenueResponseMessage | VR.VenueReadResponseMessage | DiscoveryResponse.DiscoveryDeleteResponse>;

let messager: VenueRabbitNetworkHandler | undefined;
let database: Database | undefined;
let configuration: z.infer<typeof ConfigurationSchema> | undefined;

// This file will be '/build/src/index.js' and so up two levels to / and down into config
fs.readFile(process.env.UEMS_TARTARUS_CONFIG_LOCATION ?? path.join(__dirname, '..', '..', 'config', 'configuration.json'), { encoding: 'utf8' })
    .then((file) => {
        __.debug('loaded configuration file');

        configuration = ConfigurationSchema.parse(JSON.parse(file));
    })
    .then(() => (new Promise<Database>((resolve, reject) => {
        if (!configuration) {
            __.error('reached an uninitialised configuration, this should not be possible');
            tryApplyTrait('config', false);
            reject(new Error('uninitialised configuration'));
            return;
        }
        tryApplyTrait('config', true);

        __.info('setting up database connection');

        database = new Database(configuration.database);

        const unbind = database.once('error', (err) => {
            __.error('failed to setup the database connection', {
                error: err,
            });
            tryApplyTrait('database', false);

            reject(err);
        });

        database.once('ready', () => {
            __.info('database connection enabled');
            tryApplyTrait('database', true);
            // Make sure we dont later try and reject a resolved promise from an unrelated error
            unbind();
            resolve(database);
        });
    })))
    .then(() => (new Promise((resolve, reject) => {
        if (!configuration) {
            __.error('reached an uninitialised configuration, this should not be possible');
            reject(new Error('uninitialised configuration'));
            tryApplyTrait('database', false);
            return;
        }

        __.info('setting up the message broker');

        const incoming = new VenueMessageValidator();
        const outgoing = new VenueResponseValidator();
        const discoveryIncoming = new DiscoveryMessageValidator();
        const discoveryOutgoing = new DiscoveryResponseValidator();

        messager = new RabbitNetworkHandler(
            configuration.message,
            async (data: any) => {
                console.log('in', data);
                try {
                    const r = await incoming.validate(data);
                    if (r) return r;
                } catch (e) {
                }
                return await discoveryIncoming.validate(data);
            },
            async (data: any) => {
                try {
                    const r = await outgoing.validate(data);
                    if (r) return r;
                } catch (e) {
                }
                return await discoveryOutgoing.validate(data);
            },
        );

        const unbind = messager.once('error', (err) => {
            __.error('failed to setup the message broker', {
                error: err,
            });
            tryApplyTrait('rabbitmq', false);

            reject(err);
        });

        messager.once('ready', () => {
            __.info('message broker enabled');
            tryApplyTrait('rabbitmq', true);
            // Make sure we dont later try and reject a resolved promise from an unrelated error
            unbind();
            resolve();
        });
    })))
    .then(() => {
        if (!messager || !database) {
            __.error('reached an uninitialised database or messenger, this should not be possible');
            tryApplyTrait('rabbitmq', false);
            tryApplyTrait('database', false);
            throw new Error('uninitialised database or messenger');
        }

        __.info('binding database to messenger');

        bind(database, messager);

        // We're ready to start!
        __.info('tartarus up and running');
    })
    .catch((err) => {
        __.error('failed to launch', {
            error: err as unknown,
        });
    });
