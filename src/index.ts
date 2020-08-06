import fs from 'fs/promises';
import path from 'path';
import * as z from 'zod';
import { _ml } from './logging/Log';
import { MessagingConfigurationSchema, RabbitNetworkHandler } from './networking/Messaging';
import { Database, MongoDBConfigurationSchema } from './database/Database';
import bind from './binding/VenueDatabaseBinding';

const __ = _ml(__filename);
const _b = _ml(`${__filename} | bind`);

__.info('starting tartarus...');

const ConfigurationSchema = z.object({
    message: MessagingConfigurationSchema,
    database: MongoDBConfigurationSchema,
});

let messager: RabbitNetworkHandler | undefined;
let database: Database | undefined;
let configuration: z.infer<typeof ConfigurationSchema> | undefined;

fs.readFile(path.join(__dirname, '..', 'config', 'configuration.json'), { encoding: 'utf8' })
    .then((file) => {
        __.debug('loaded configuration file');

        configuration = ConfigurationSchema.parse(JSON.parse(file));
    })
    .then(() => (new Promise<Database>((resolve, reject) => {
        if (!configuration) {
            __.error('reached an uninitialised configuration, this should not be possible');
            reject(new Error('uninitialised configuration'));
            return;
        }

        __.info('setting up database connection');

        database = new Database(configuration.database);

        const unbind = database.once('error', (err) => {
            __.error('failed to setup the database connection', {
                error: err,
            });

            reject(err);
        });

        database.once('ready', () => {
            __.info('database connection enabled');
            // Make sure we dont later try and reject a resolved promise from an unrelated error
            unbind();
            resolve(database);
        });
    })))
    .then(() => (new Promise((resolve, reject) => {
        if (!configuration) {
            __.error('reached an uninitialised configuration, this should not be possible');
            reject(new Error('uninitialised configuration'));
            return;
        }

        __.info('setting up the message broker');

        messager = new RabbitNetworkHandler(configuration.message);

        const unbind = messager.once('error', (err) => {
            __.error('failed to setup the message broker', {
                error: err,
            });

            reject(err);
        });

        messager.once('ready', () => {
            __.info('message broker enabled');
            // Make sure we dont later try and reject a resolved promise from an unrelated error
            unbind();
            resolve();
        });
    })))
    .then(() => {
        if (!messager || !database) {
            __.error('reached an uninitialised database or messenger, this should not be possible');
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
