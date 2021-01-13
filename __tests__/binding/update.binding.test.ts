import { Db, MongoClient, ObjectId } from "mongodb";
import { defaultAfterAll, defaultAfterEach, defaultBeforeAll, defaultBeforeEach } from "../utilities/setup";
import { BindingBroker } from "../utilities/BindingBroker";
import { BaseSchema } from "@uems/uemscommlib/build/BaseSchema";
import Intentions = BaseSchema.Intentions;
import { EntStateMessage, MsgStatus, StateMessage, TopicMessage, VenueMessage } from "@uems/uemscommlib";

import DeleteVenueMessage = VenueMessage.DeleteVenueMessage;
import UpdateVenueMessage = VenueMessage.UpdateVenueMessage;
import ReadVenueMessage = VenueMessage.ReadVenueMessage;
import CreateVenueMessage = VenueMessage.CreateVenueMessage;
import { RabbitNetworkHandler } from "../../src/networking/Messaging";
import { Database } from "../../src/database/Database";
import bind from "../../src/binding/VenueDatabaseBinding";
// updating normal works
// updating duplicate fails

const empty = <T extends Intentions>(intention: T): { msg_intention: T, msg_id: 0, status: 0, userID: string } => ({
    msg_intention: intention,
    msg_id: 0,
    status: 0,
    userID: 'user',
})

describe('create messages of states', () => {
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
            date: DATE,
        }, {
            _id: new ObjectId('56d9bf92f9be48771d6fe5b4'),
            name: 'name other',
            capacity: 1000,
            color: '#aaaaaa',
            user: 'something',
            date: DATE,
        }], client, db)
    });
    afterEach(() => defaultAfterEach(client, db));

    it('should allow normal updating', async (done) => {
        const id = '56d9bf92f9be48771d6fe5b2';
        broker.emit('update', {
            ...empty('UPDATE'),
            color: '#aaaaaa',
            name: 'new name',
            id,
        }, 'venues.details.update', (message) => {
            expect(message).toHaveProperty('result');
            expect(message).toHaveProperty('status');
            console.log(message);

            expect(message.status).toEqual(MsgStatus.SUCCESS);
            expect(message.result).toHaveLength(1);
            expect(message.result[0]).toEqual(id);

            broker.emit('query', { ...empty('READ'), id }, 'venues.details.read', (data) => {
                expect(data).toHaveProperty('result');
                expect(data).toHaveProperty('status');

                expect(data.status).toEqual(MsgStatus.SUCCESS);
                expect(data.result).toHaveLength(1);
                expect(data.result[0]).toHaveProperty('color', '#aaaaaa');
                expect(data.result[0]).toHaveProperty('name', 'new name');

                done();
            });
        });
    });

    it('should prevent duplicating entries', async (done) => {
        const id = '56d9bf92f9be48771d6fe5b2';
        broker.emit('update', {
            ...empty('UPDATE'),
            color: '#aaaaaa',
            name: 'name other',
            id,
        }, 'venues.details.update', (message) => {
            expect(message).toHaveProperty('result');
            expect(message).toHaveProperty('status');

            expect(message.status).toEqual(MsgStatus.FAIL);
            expect(message.result).toHaveLength(1);
            expect(message.result[0]).toContain('existing');

            done();
        });
    });

});
