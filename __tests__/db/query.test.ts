// should return return all when query is empty
// should return onyl valid properties
// should only return one matching entry when querying by ID
// query by substring works
// query by invalid id returns no result

import { Db, MongoClient, ObjectId } from "mongodb";
import {
    defaultAfterAll,
    defaultAfterEach,
    defaultBeforeAll,
    defaultBeforeEach,
    haveNoAdditionalKeys
} from "../utilities/setup";
import { BaseSchema } from "@uems/uemscommlib/build/BaseSchema";
import Intentions = BaseSchema.Intentions;
import { Database } from "../../src/database/Database";

const empty = <T extends Intentions>(intention: T): { msg_intention: T, msg_id: 0, status: 0, userID: string } => ({
    msg_intention: intention,
    msg_id: 0,
    status: 0,
    userID: 'user',
})

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
        date: Date.now()
    }, {
        _id: new ObjectId('56d9bf92f9be48771d6fe5b4'),
        name: 'name other one',
        capacity: 1000,
        color: '#aaaaaa',
        user: 'something',
        date: Date.now()
    }], client, db));

    afterEach(() => defaultAfterEach(client, db));

    let venueDB: Database;

    beforeAll(() => {
        venueDB = new Database({ client, database: 'testing', collection: 'details' });
    })

    it('should return return all when query is empty', async () => {
        const query = await venueDB.query({ ...empty('READ') });
        expect(query).toHaveLength(2);
        let find = query.find((e) => e.id === '56d9bf92f9be48771d6fe5b2');
        expect(find).not.toBeUndefined();
        expect(find).toEqual({
            id: '56d9bf92f9be48771d6fe5b2',
            name: 'name',
            capacity: 1000,
            color: '#aaaaaa',
            user: 'something',
        });
        find = query.find((e) => e.id === '56d9bf92f9be48771d6fe5b4');
        expect(find).not.toBeUndefined();
        expect(find).toEqual({
            id: '56d9bf92f9be48771d6fe5b4',
            name: 'name other one',
            capacity: 1000,
            color: '#aaaaaa',
            user: 'something',
        });
    });

    it('should return only valid properties', async () => {
        const query = await venueDB.query({ ...empty('READ'), id: '56d9bf92f9be48771d6fe5b4' });
        expect(query).toHaveLength(1);
        expect(haveNoAdditionalKeys(query[0], ['name', 'capacity', 'color', 'id', 'user']));
    });

    it('query by substring works', async () => {
        const query = await venueDB.query({ ...empty('READ'), name: 'one' });
        expect(query).toHaveLength(1);
        expect(query[0]).toEqual({
            id: '56d9bf92f9be48771d6fe5b4',
            name: 'name other one',
            color: '#aaaaaa',
            capacity: 1000,
            user: 'something',
        });
    });

    it('query by invalid id returns no result', async () => {
        const query = await venueDB.query({ ...empty('READ'), id: '56d9bf92f9be48771d6fe5b9' });
        expect(query).toHaveLength(0);
    });

});
