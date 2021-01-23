import { Db, MongoClient, ObjectId } from 'mongodb';
import { BaseSchema, MsgStatus, VenueMessage } from '@uems/uemscommlib';
import { defaultAfterAll, defaultAfterEach, defaultBeforeAll, defaultBeforeEach } from '../utilities/setup';
import { BindingBroker } from '../utilities/BindingBroker';

import { RabbitNetworkHandler } from '../../src/networking/Messaging';
import { Database } from '../../src/database/Database';
import bind from '../../src/binding/VenueDatabaseBinding';
import Intentions = BaseSchema.Intentions;
import DeleteVenueMessage = VenueMessage.DeleteVenueMessage;
import UpdateVenueMessage = VenueMessage.UpdateVenueMessage;
import ReadVenueMessage = VenueMessage.ReadVenueMessage;
import CreateVenueMessage = VenueMessage.CreateVenueMessage;

const empty = <T extends Intentions>(intention: T): { msg_intention: T, msg_id: 0, status: 0, userID: string } => ({
    msg_intention: intention,
    msg_id: 0,
    status: 0,
    userID: 'user',
});
// query for invalid returns nothing
// query for id returns one
// empty queries allowed

describe('query binding messages', () => {
    let client!: MongoClient;
    let db!: Db;

    let broker!: BindingBroker<ReadVenueMessage, DeleteVenueMessage, UpdateVenueMessage, CreateVenueMessage, VenueMessage.VenueMessage>;
    let fakeBroker!: RabbitNetworkHandler;

    let venueDB!: Database;
    const DATE = Date.now();

    beforeAll(async () => {
        const { client: newClient, db: newDb } = await defaultBeforeAll();
        client = newClient;
        db = newDb;

        broker = new BindingBroker();
        fakeBroker = broker as unknown as RabbitNetworkHandler;

        venueDB = new Database({ client, database: 'testing', collection: 'details' });
    });
    afterAll(() => defaultAfterAll(client, db));
    beforeEach(() => {
        broker.clear();
        bind(venueDB, fakeBroker);
        defaultBeforeEach([{
            _id: new ObjectId('56d9bf92f9be48771d6fe5b2'),
            name: 'name',
            capacity: 1000,
            color: '#aaaaaa',
            user: 'something',
            date: Date.now(),
        }, {
            _id: new ObjectId('56d9bf92f9be48771d6fe5b4'),
            name: 'name other one',
            capacity: 1000,
            color: '#aaaaaa',
            user: 'something',
            date: Date.now(),
        }], client, db);
    });
    afterEach(() => defaultAfterEach(client, db));

    it('should support querying by id', async (done) => {
        broker.emit('query', {
            ...empty('READ'),
            id: '56d9bf92f9be48771d6fe5b2',
        }, 'venues.details.read', (message) => {
            expect(message).toHaveProperty('result');
            expect(message).toHaveProperty('status');

            expect(message.status).toEqual(MsgStatus.SUCCESS);
            expect(message.result).toHaveLength(1);

            expect(message.result[0]).toHaveProperty('name', 'name');
            expect(message.result[0]).toHaveProperty('capacity', 1000);
            expect(message.result[0]).toHaveProperty('color', '#aaaaaa');
            expect(message.result[0]).toHaveProperty('user', 'something');

            done();
        });
    });

    it('should support empty queries', async (done) => {
        broker.emit('query', {
            ...empty('READ'),
        }, 'venues.details.read', (message) => {
            expect(message).toHaveProperty('result');
            expect(message).toHaveProperty('status');

            expect(message.status).toEqual(MsgStatus.SUCCESS);
            expect(message.result).toHaveLength(2);

            let find = message.result.find((e: any) => e.id === '56d9bf92f9be48771d6fe5b2');
            expect(find).not.toBeUndefined();
            expect(find).toEqual({
                id: '56d9bf92f9be48771d6fe5b2',
                name: 'name',
                capacity: 1000,
                color: '#aaaaaa',
                user: 'something',
            });
            find = message.result.find((e: any) => e.id === '56d9bf92f9be48771d6fe5b4');
            expect(find).not.toBeUndefined();
            expect(find).toEqual({
                id: '56d9bf92f9be48771d6fe5b4',
                name: 'name other one',
                capacity: 1000,
                color: '#aaaaaa',
                user: 'something',
            });

            done();
        });
    });

});
