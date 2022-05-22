import { Db, FilterQuery, MongoClient, ObjectId } from 'mongodb';
import { createNanoEvents, Unsubscribe } from 'nanoevents';
import * as z from 'zod';
import { has, VenueMessage, VenueResponse } from '@uems/uemscommlib';
import {
    genericCreate,
    genericDelete,
    genericEntityConversion,
    genericUpdate
} from '@uems/micro-builder/build/src/utility/GenericDatabaseFunctions';
import { ClientFacingError } from '@uems/micro-builder/build/src/errors/ClientFacingError';
import { _ml } from '../logging/Log';
import InternalVenue = VenueResponse.InternalVenue;
import CreateVenueMessage = VenueMessage.CreateVenueMessage;

const __ = _ml(__filename);

export type InDatabaseVenue = {
    _id: ObjectId,
    name: string,
    capacity: number,
    color?: string,
    user: string,
    date: number,
};

export type CreateInDatabaseVenue = Omit<InDatabaseVenue, '_id'>;

const dbToInternal = (data: InDatabaseVenue): InternalVenue => genericEntityConversion(
    data,
    {
        name: 'name',
        user: 'user',
        color: 'color',
        capacity: 'capacity',
        _id: 'id',
    },
    '_id',
);

const createToDb = (data: CreateVenueMessage): CreateInDatabaseVenue => ({
    ...genericEntityConversion(
        data,
        {
            capacity: 'capacity',
            color: 'color',
            userid: 'user',
            name: 'name',
        },
    ),
    date: Date.now(),
});

/**
 * Interface for all data sources designed to be used for manipulating venues
 */
export interface VenueDatabase {

    /**
     * Queries the database for venues matching a set of critera. Returns an array of matching events in a promise like
     * format
     * @param query the query received by the system
     */
    query(query: VenueMessage.ReadVenueMessage): Promise<InternalVenue[]> | PromiseLike<InternalVenue[]>;

    /**
     * Creates a new venue in the data store with the provided property. Returns an array of IDs of the created
     * resources
     * @param create the create instruction received by the system
     */
    create(create: VenueMessage.CreateVenueMessage): Promise<string[]> | PromiseLike<string[]>;

    /**
     * Deletes an existing venue in the data store with the provided id. Returns an array of the ids adjusted by this
     * instruction
     * @param del the delete instruction received by the system
     */
    delete(del: VenueMessage.DeleteVenueMessage): Promise<string[]> | PromiseLike<string[]>;

    /**
     * Updates an existing venue in the data store with the provided updates. Returns an array of the ids of adjusted
     * objects by this instruction
     * @param update the update instruction received by the system
     */
    update(update: VenueMessage.UpdateVenueMessage): Promise<string[]> | PromiseLike<string[]>;

}

/**
 * A schema describing the settings for a database connection. Settings is left loosly typed but is meant to represent
 * {@link MongoClientOptions} but it is an equal loose type apparently as it accepts this type.
 */
export const MongoDBConfigurationSchema = z.object({
    username: z.string(),
    password: z.string(),
    uri: z.string(),
    port: z.number(),
    server: z.string(),
    database: z.string(),
    collection: z.string(),
    settings: z.object({}).nonstrict().optional(),
});

/**
 * The inferred type of {@link MongoDBConfigurationSchema}.
 */
export type MongoDBConfiguration = z.infer<typeof MongoDBConfigurationSchema>;

/**
 * An interface describing the events and handlers for the database class
 */
interface DatabaseEvents {
    /**
     * Emitted when the class has fully connected to the database and is ready to work
     */
    ready: () => void,
    /**
     * Emitted when there is an error raised during operation. Parameter is the error raised if appropriate or
     * undefined. As the errors can technically be any type is is left as unknown.
     * @param err the error raised by the erroring region or undefined if none is provided
     */
    error: (err: unknown) => void,
}

/**
 * A class implementing the venue database operations against a MongoDB connection
 */
export class Database implements VenueDatabase {

    /**
     * The emitter through which updates about this connection will be sent
     * @private
     */
    private _emitter = createNanoEvents<DatabaseEvents>();

    /**
     * The connection to the MongoDB server
     * @private
     */
    private _client?: MongoClient;

    /**
     * The database we are connected to and on which we are performing operations
     * @private
     */
    private _database?: Db;

    /**
     * If this class currently has an good connection to the database
     * @private
     */
    private _connected = false;

    constructor(
        /**
         * The configuration for connecting to the database which will be used to form the URI string and connection
         * settings
         */
        private _configuration: MongoDBConfiguration | { client: MongoClient, database: string, collection: string },
    ) {
        const clear = this.once('ready', () => {
            clear();

            if (!this._database) throw new Error('ready was thrown when it wasn\'t ready');
            void this._database.collection(this._configuration.collection).createIndex(
                { name: 'text' },
                //{ unique: true },
            );
        });

        if (MongoDBConfigurationSchema.check(_configuration)) {
            const username = encodeURIComponent(_configuration.username);
            const password = encodeURIComponent(_configuration.password);
            const uri = encodeURIComponent(_configuration.uri);
            const server = encodeURIComponent(_configuration.server);
            const { port } = _configuration;

            MongoClient.connect(
                `mongodb://${username}:${password}@${uri}:${port}/${server}`,
                {
                    ..._configuration.settings,
                    useNewUrlParser: true,
                    useUnifiedTopology: true,
                },
            ).then((client) => {
                this._client = client;
                this._database = client.db(_configuration.database);

                this._connected = true;
                this._emitter.emit('ready');
            }).catch((err: unknown) => {
                this._emitter.emit('error', err);
            });
        } else {
            this._client = _configuration.client;
            this._database = this._client.db(_configuration.database);
            this._connected = true;
            this._emitter.emit('ready');
        }
    }

    query = async (query: VenueMessage.ReadVenueMessage): Promise<InternalVenue[]> => {
        if (!this._database) throw new Error('database was used before it was ready');

        const find: FilterQuery<InDatabaseVenue> = {};

        // TODO: error handling and better typing
        if (query.id) {
            if (typeof (query.id) === 'string') {
                find._id = new ObjectId(query.id);
            } else {
                find._id = {
                    $in: query.id.map((e) => new ObjectId(e)),
                };
            }
        }

        if (query.name) {
            find.$text = {
                $search: query.name,
            };
        }

        if (query.capacity) {
            find.capacity = query.capacity;
        }

        if (query.approximate_capacity) {
            const fuzziness = query.approximate_fuzziness ?? 20;

            find.capacity = {
                $lte: query.approximate_capacity + fuzziness,
                $gte: query.approximate_capacity - fuzziness,
            };
        }

        if (query.maximum_capacity) {
            if (has(find, 'capacity')) {
                (find.capacity as Record<string, unknown>).$lte = query.maximum_capacity;
            } else {
                find.capacity = {
                    $lte: query.maximum_capacity,
                };
            }
        }

        if (query.minimum_capacity) {
            if (has(find, 'capacity')) {
                (find.capacity as Record<string, unknown>).$gte = query.minimum_capacity;
            } else {
                find.capacity = {
                    $gte: query.minimum_capacity,
                };
            }
        }

        return (await this._database
            .collection(this._configuration.collection)
            .find(find)
            .toArray()).map((e) => dbToInternal(e));
    };

    async create(create: VenueMessage.CreateVenueMessage): Promise<string[]> {
        if (!this._database) throw new Error('database was used before it was ready');

        return genericCreate(create, createToDb, this._database.collection(this._configuration.collection), () => {
            throw new ClientFacingError('duplicate venue name');
        });
    }

    async delete(del: VenueMessage.DeleteVenueMessage): Promise<string[]> {
        if (!this._database) throw new Error('database was used before it was ready');

        const { id } = del;
        if (!ObjectId.isValid(id)) {
            throw new Error('invalid object ID');
        }

        return genericDelete<InDatabaseVenue>(
            { _id: new ObjectId(id) },
            id,
            this._database.collection(this._configuration.collection),
        );
    }

    async update(update: VenueMessage.UpdateVenueMessage): Promise<string[]> {
        if (!this._database) throw new Error('database was used before it was ready');

        const { id } = update;

        if (!ObjectId.isValid(id)) {
            throw new Error('invalid object ID');
        }

        return genericUpdate(
            update,
            ['capacity', 'color', 'name'],
            this._database.collection(this._configuration.collection),
            undefined,
            () => {
                throw new ClientFacingError('cannot update to existing venue name');
            },
        );
    }

    /**
     * Attaches an event listener to the underlying event emitter used by this database handler
     * @param event the event on which this listener should listen
     * @param callback the callback to be executed when the event is emitted
     */
    public on<E extends keyof DatabaseEvents>(
        event: E,
        callback: DatabaseEvents[E],
    ): Unsubscribe {
        return this._emitter.on(event, callback);
    }

    /**
     * Registers an event handler which will be instantly unbound when called and therefore only executed on the first
     * event after this handler is registered
     * @param event the event on which this listener should be registered
     * @param callback the callback to be executed on the first occurrence of this emit
     */
    public once<E extends keyof DatabaseEvents>(
        event: E,
        callback: DatabaseEvents[E],
    ) {
        const unbind = this._emitter.on(event, (...args: any[]) => {
            unbind();

            // @ts-ignore
            callback(...args);
        });

        return unbind;
    }
}
