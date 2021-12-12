import { Db, MongoClient } from 'mongodb';
import { BaseSchema, MsgStatus, VenueMessage } from '@uems/uemscommlib';
import { defaultAfterAll, defaultAfterEach, defaultBeforeAll, defaultBeforeEach } from '../utilities/setup';
import { BindingBroker } from '../utilities/BindingBroker';

import { RabbitNetworkHandler } from '@uems/micro-builder/build/src/messaging/GenericRabbitNetworkHandler';
import { Database } from '../../src/database/Database';
import bind from '../../src/binding/VenueDatabaseBinding';
import Intentions = BaseSchema.Intentions;
import ReadVenueMessage = VenueMessage.ReadVenueMessage;
import DeleteVenueMessage = VenueMessage.DeleteVenueMessage;
import UpdateVenueMessage = VenueMessage.UpdateVenueMessage;
import CreateVenueMessage = VenueMessage.CreateVenueMessage;
import { VenueRabbitNetworkHandler } from "../../src";
// creating normal works
// creating duplicate fails
// undefined db fails successfully

const empty = <T extends Intentions>(intention: T): { msg_intention: T, msg_id: 0, status: 0, userID: string } => ({
    msg_intention: intention,
    msg_id: 0,
    status: 0,
    userID: 'user',
});

describe('create messages of states', () => {
    let client!: MongoClient;
    let db!: Db;
    let venueDB!: Database;

    let broker!: BindingBroker<ReadVenueMessage, DeleteVenueMessage, UpdateVenueMessage, CreateVenueMessage, VenueMessage.VenueMessage>;
    let fakeBroker!: VenueRabbitNetworkHandler;

    beforeAll(async () => {
        const { client: newClient, db: newDb } = await defaultBeforeAll();
        client = newClient;
        db = newDb;

        broker = new BindingBroker();
        fakeBroker = broker as unknown as VenueRabbitNetworkHandler;

        venueDB = new Database({ client, collection: 'details', database: 'testing' });
    });
    afterAll(() => defaultAfterAll(client, db));
    beforeEach(() => {
        broker.clear();
        bind(venueDB, fakeBroker);
        defaultBeforeEach([], client, db);
    });
    afterEach(() => defaultAfterEach(client, db));

    it('should allow creates to take place', async (done) => {
        broker.emit('create', {
            ...empty('CREATE'),
            name: 'name',
            userid: 'icon',
            capacity: 1000,
            color: '#aaaaaa',
        }, 'venues.details.create', (creation) => {
            expect(creation).toHaveProperty('result');
            expect(creation).toHaveProperty('status');

            expect(creation.status).toEqual(MsgStatus.SUCCESS);
            expect(creation.result).toHaveLength(1);

            broker.emit('query', { ...empty('READ'), id: creation.result[0] }, 'venues.details.read', (data) => {
                expect(data).toHaveProperty('result');
                expect(data).toHaveProperty('status');

                expect(data.status).toEqual(MsgStatus.SUCCESS);
                expect(data.result).toHaveLength(1);
                expect(data.result[0]).toHaveProperty('color', '#aaaaaa');
                expect(data.result[0]).toHaveProperty('capacity', 1000);
                expect(data.result[0]).toHaveProperty('name', 'name');

                done();
            });
        });
    });

    it('should prevent creating duplicate entries', async (done) => {
        broker.emit('create', {
            ...empty('CREATE'),
            name: 'name',
            userid: 'icon',
            capacity: 1000,
            color: '#aaaaaa',
        }, 'venues.details.create', (creation) => {
            expect(creation).toHaveProperty('result');
            expect(creation).toHaveProperty('status');

            expect(creation.status).toEqual(MsgStatus.SUCCESS);
            expect(creation.result).toHaveLength(1);

            broker.emit('create', {
                ...empty('CREATE'),
                name: 'name',
                userid: 'icon',
                capacity: 1000,
                color: '#aaaaaa',
            }, 'venues.details.create', (second) => {
                expect(second).toHaveProperty('result');
                expect(second).toHaveProperty('status');

                expect(second.status).toEqual(MsgStatus.FAIL);
                expect(second.result).toHaveLength(1);
                expect(second.result[0]).toContain('duplicate');

                done();
            });
        });
    });

    it('should fail gracefully if the database is dead', async (done) => {
        const db: Database = new Proxy(venueDB, {
            get(target: Database, p: PropertyKey, receiver: any): any {
                console.log('???x2');
                throw new Error('proxied database throwing error');
            },
        });

        broker.clear();
        bind(db, fakeBroker);

        broker.emit('create', {
            ...empty('CREATE'),
            color: '#aaaaaa',
            name: 'name',
            userid: 'icon',
            capacity: 1000,
        }, 'venues.details.create', (message) => {
            expect(message).toHaveProperty('result');
            expect(message).toHaveProperty('status');

            expect(message.status).not.toEqual(MsgStatus.SUCCESS);
            expect(message.result).toHaveLength(1);
            expect(message.result[0]).toEqual('internal server error');

            done();
        });
    });

});
