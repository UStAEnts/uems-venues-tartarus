import { Db, MongoClient } from 'mongodb';
import { BaseSchema } from '@uems/uemscommlib';
import {
    defaultAfterAll,
    defaultAfterEach,
    defaultBeforeAll,
    defaultBeforeEach,
    haveNoAdditionalKeys
} from '../utilities/setup';
import { Database } from '../../src/database/Database';
import Intentions = BaseSchema.Intentions;

const empty = <T extends Intentions>(intention: T): { msg_intention: T, msg_id: 0, status: 0, userID: string } => ({
    msg_intention: intention,
    msg_id: 0,
    status: 0,
    userID: 'user',
});

describe('create messages of states', () => {
    let client!: MongoClient;
    let db!: Db;

    beforeAll(async () => {
        const { client: newClient, db: newDb } = await defaultBeforeAll();
        client = newClient;
        db = newDb;
    });
    afterAll(() => defaultAfterAll(client, db));
    beforeEach(() => defaultBeforeEach([], client, db));
    afterEach(() => defaultAfterEach(client, db));

    let venueDB: Database;

    beforeAll(() => {
        venueDB = new Database({ client, database: 'testing', collection: 'details' });
    });

    it('basic create inserts into the database', async () => {
        const result = await venueDB.create({
            ...empty('CREATE'),
            name: 'name',
            color: 'color',
            userid: 'ab',
            capacity: 1000,
        });

        expect(result).toHaveLength(1);
        expect(typeof (result[0]) === 'string').toBeTruthy();

        const query = await venueDB.query({ ...empty('READ') });
        expect(query).toHaveLength(1);
        expect(query[0].name).toEqual('name');
        expect(haveNoAdditionalKeys(query[0], ['name', 'capacity', 'color', 'id', 'user', 'date']));
    });

    it('should not include additional properties in creating records', async () => {
        const result = await venueDB.create({
            ...empty('CREATE'),
            name: 'name distinct',
            userid: 'icon',
            capacity: 1000,
            color: 'color',
            // @ts-ignore
            addProp: 'one',
            something: 'else',
        });

        expect(result).toHaveLength(1);
        expect(typeof (result[0]) === 'string').toBeTruthy();

        const query = await venueDB.query({ ...empty('READ') });
        expect(query).toHaveLength(1);
        expect(query[0].name).toEqual('name distinct');
        expect(haveNoAdditionalKeys(query[0], ['name', 'capacity', 'color', 'id', 'user']));
    });

    // TODO: See update.test.ts#178
    // it('should reject creation of duplicate names', async () => {
    //     const result = await venueDB.create({
    //         ...empty('CREATE'),
    //         name: 'name',
    //         userid: 'icon',
    //         capacity: 1000,
    //         color: 'color',
    //     });
    //
    //     expect(result).toHaveLength(1);
    //     expect(typeof (result[0]) === 'string').toBeTruthy();
    //
    //     await expect(venueDB.create({
    //         ...empty('CREATE'),
    //         name: 'name',
    //         userid: 'icon',
    //         capacity: 1000,
    //         color: 'color',
    //     })).rejects.toThrowError('duplicate venue name');
    // });

});
