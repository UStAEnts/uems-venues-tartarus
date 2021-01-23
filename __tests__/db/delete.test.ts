import { Db, MongoClient, ObjectId } from 'mongodb';
import { BaseSchema } from '@uems/uemscommlib';
import { defaultAfterAll, defaultAfterEach, defaultBeforeAll, defaultBeforeEach } from '../utilities/setup';
import { Database } from '../../src/database/Database';
import Intentions = BaseSchema.Intentions;

const empty = <T extends Intentions>(intention: T): { msg_intention: T, msg_id: 0, status: 0, userID: string } => ({
    msg_intention: intention,
    msg_id: 0,
    status: 0,
    userID: 'user',
});

describe('delete messages of states', () => {
    let client!: MongoClient;
    let db!: Db;

    beforeAll(async () => {
        const { client: newClient, db: newDb } = await defaultBeforeAll();
        client = newClient;
        db = newDb;
    });
    afterAll(() => defaultAfterAll(client, db));

    beforeEach(() => defaultBeforeEach([{
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
    }], client, db));

    afterEach(() => defaultAfterEach(client, db));

    let venueDB: Database;

    beforeAll(() => {
        venueDB = new Database({ client, database: 'testing', collection: 'details' });
    });

    it('should allow basic deletes to perform successfully', async () => {
        const id = '56d9bf92f9be48771d6fe5b2';
        const remove = await venueDB.delete({ ...empty('DELETE'), id });
        expect(remove).toHaveLength(1);
        expect(remove).toEqual([id]);

        const query = await venueDB.query(empty('READ'));
        expect(query).toHaveLength(1);
        expect(query[0]).toHaveProperty('id', '56d9bf92f9be48771d6fe5b4');
    });

    it('should reject when deleting with a non-existent id', async () => {
        const id = '56d9bf92f9be48771d6fe5b9';
        await expect(venueDB.delete({ ...empty('DELETE'), id })).rejects.toThrowError('invalid entity ID');

        const query = await venueDB.query(empty('READ'));
        expect(query).toHaveLength(2);
    });

    it('should support deleting with additional properties', async () => {
        const id = '56d9bf92f9be48771d6fe5b2';
        // @ts-ignore
        const remove = await venueDB.delete({ ...empty('DELETE'), id, other: 'additional' });
        expect(remove).toHaveLength(1);
        expect(remove).toEqual([id]);

        const query = await venueDB.query(empty('READ'));
        expect(query).toHaveLength(1);
        expect(query[0]).toHaveProperty('id', '56d9bf92f9be48771d6fe5b4');
    });

});
