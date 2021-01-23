import { Db, MongoClient, ObjectId } from 'mongodb';
import { BaseSchema, MsgStatus, VenueMessage } from '@uems/uemscommlib';
import { defaultAfterAll, defaultAfterEach, defaultBeforeAll, defaultBeforeEach } from '../utilities/setup';
import { BindingBroker } from '../utilities/BindingBroker';

import { Database } from '../../src/database/Database';
import { RabbitNetworkHandler } from '../../src/networking/Messaging';
import bind from '../../src/binding/VenueDatabaseBinding';
import Intentions = BaseSchema.Intentions;
import DeleteVenueMessage = VenueMessage.DeleteVenueMessage;
import UpdateVenueMessage = VenueMessage.UpdateVenueMessage;
import ReadVenueMessage = VenueMessage.ReadVenueMessage;
import CreateVenueMessage = VenueMessage.CreateVenueMessage;
// delete works
// delete unknown fails
const empty = <T extends Intentions>(intention: T): { msg_intention: T, msg_id: 0, status: 0, userID: string } => ({
    msg_intention: intention,
    msg_id: 0,
    status: 0,
    userID: 'user',
});

describe('create messages of states', () => {
    let client!: MongoClient;
    let db!: Db;

    let broker!: BindingBroker<ReadVenueMessage, DeleteVenueMessage, UpdateVenueMessage, CreateVenueMessage, VenueMessage.VenueMessage>;
    let fakeBroker!: RabbitNetworkHandler;

    let venueDB!: Database;

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
            name: 'name other',
            capacity: 1000,
            color: '#aaaaaa',
            user: 'something',
            date: Date.now(),
        }], client, db);
    });
    afterEach(() => defaultAfterEach(client, db));

    it('should allow valid delete instructions', async (done) => {
        broker.emit('delete', {
            ...empty('DELETE'),
            id: '56d9bf92f9be48771d6fe5b2',
        }, 'venues.details.delete', (message) => {
            expect(message).toHaveProperty('result');
            expect(message).toHaveProperty('status');

            expect(message.status).toEqual(MsgStatus.SUCCESS);
            expect(message.result).toHaveLength(1);
            expect(message.result[0]).toEqual('56d9bf92f9be48771d6fe5b2');

            broker.emit('query', { ...empty('READ') }, 'venues.details.read', (read) => {
                expect(read).toHaveProperty('result');
                expect(read).toHaveProperty('status');

                expect(read.status).toEqual(MsgStatus.SUCCESS);
                expect(read.result).toHaveLength(1);
                expect(read.result[0]).toHaveProperty('id', '56d9bf92f9be48771d6fe5b4');

                done();
            });
        });
    });

    it('should reject on invalid delete', async (done) => {
        broker.emit('delete', {
            ...empty('DELETE'),
            id: '56d9bf92f9be48771d6fe5b9',
        }, 'venues.details.delete', (message) => {
            expect(message).toHaveProperty('result');
            expect(message).toHaveProperty('status');

            expect(message.status).toEqual(MsgStatus.FAIL);
            expect(message.result).toHaveLength(1);

            broker.emit('query', { ...empty('READ') }, 'venues.details.read', (read) => {
                expect(read).toHaveProperty('result');
                expect(read).toHaveProperty('status');

                expect(read.status).toEqual(MsgStatus.SUCCESS);
                expect(read.result).toHaveLength(2);

                expect(read.result[0]).toHaveProperty('id');
                expect(read.result[1]).toHaveProperty('id');

                expect(read.result[0].id === '56d9bf92f9be48771d6fe5b4' || read.result[0].id === '56d9bf92f9be48771d6fe5b2').toBeTruthy();
                expect(read.result[1].id === '56d9bf92f9be48771d6fe5b4' || read.result[1].id === '56d9bf92f9be48771d6fe5b2').toBeTruthy();

                done();
            });
        });
    });

});
