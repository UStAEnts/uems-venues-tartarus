// basic
// adding properties does not work
// no changes should not work

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

    const DATE = Date.now();
    beforeEach(() => defaultBeforeEach([{
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
    }], client, db));

    afterEach(() => defaultAfterEach(client, db));

    let venueDB: Database;

    beforeAll(() => {
        venueDB = new Database({ client, database: 'testing', collection: 'details' });
    });

    it('should allow updates', async () => {
        const update = await venueDB.update({
            ...empty('UPDATE'),
            color: 'new color',
            capacity: 1500,
            name: 'new name',
            id: '56d9bf92f9be48771d6fe5b2',
        });
        expect(update).toHaveLength(1);
        expect(update).toEqual(['56d9bf92f9be48771d6fe5b2']);

        const query = await venueDB.query({ ...empty('READ') });
        expect(query).toHaveLength(2);
        console.log(query);
        let find = query.find((e) => e.id === '56d9bf92f9be48771d6fe5b2');
        expect(find).not.toBeUndefined();
        expect(find).toEqual({
            id: '56d9bf92f9be48771d6fe5b2',
            name: 'new name',
            capacity: 1500,
            color: 'new color',
            user: 'something',
        });
        find = query.find((e) => e.id === '56d9bf92f9be48771d6fe5b4');
        expect(find).not.toBeUndefined();
        expect(find).toEqual({
            id: '56d9bf92f9be48771d6fe5b4',
            name: 'name other',
            capacity: 1000,
            color: '#aaaaaa',
            user: 'something',
        });
    });

    it('should reject updates with an invalid ID', async () => {
        await expect(venueDB.update({
            ...empty('UPDATE'),
            color: 'new color',
            capacity: 1500,
            name: 'new name',
            id: '56d9bf92f9be48771d6fe5b9',
        })).rejects.toThrowError('invalid entity ID');

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
            name: 'name other',
            capacity: 1000,
            color: '#aaaaaa',
            user: 'something',
        });
    });

    it('should reject with no operations', async () => {
        await expect(venueDB.update({
            ...empty('UPDATE'),
            id: '56d9bf92f9be48771d6fe5b4',
        })).rejects.toThrowError('no operations provided');

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
            name: 'name other',
            capacity: 1000,
            color: '#aaaaaa',
            user: 'something',
        });
    });

    it('should not allow changing additional properties via update', async () => {
        await expect(venueDB.update({
            ...empty('UPDATE'),
            id: '56d9bf92f9be48771d6fe5b2',
            name: 'new name',
            // @ts-ignore
            add: 'adding a property',
        })).resolves.toEqual(['56d9bf92f9be48771d6fe5b2']);

        const query = await venueDB.query({ ...empty('READ') });
        expect(query).toHaveLength(2);
        let find = query.find((e) => e.id === '56d9bf92f9be48771d6fe5b2');
        expect(find).not.toBeUndefined();
        expect(find).toEqual({
            id: '56d9bf92f9be48771d6fe5b2',
            name: 'new name',
            capacity: 1000,
            color: '#aaaaaa',
            user: 'something',
        });
        find = query.find((e) => e.id === '56d9bf92f9be48771d6fe5b4');
        expect(find).not.toBeUndefined();
        expect(find).toEqual({
            id: '56d9bf92f9be48771d6fe5b4',
            name: 'name other',
            capacity: 1000,
            color: '#aaaaaa',
            user: 'something',
        });
    });

    // TODO: this test has been disabled because of recent (2022-05-22) changes to the indexes on the venue table
    //       A full text index with a unique constraint seems to prevent any of the same words appearing in an entry
    //       which is not ideal for a venue system where there may be similar names. Therefore while this test is ideal
    //       its no longer represented by the unique index.
    //
    // it('should not allow updating to existing names', async () => {
    //     await expect(venueDB.update({
    //         ...empty('UPDATE'),
    //         id: '56d9bf92f9be48771d6fe5b2',
    //         name: 'name other',
    //     })).rejects.toThrowError('cannot update to existing venue name');
    //
    //     const query = await venueDB.query({ ...empty('READ') });
    //     expect(query).toHaveLength(2);
    //     let find = query.find((e) => e.id === '56d9bf92f9be48771d6fe5b2');
    //     expect(find).not.toBeUndefined();
    //     expect(find).toEqual({
    //         id: '56d9bf92f9be48771d6fe5b2',
    //         name: 'name',
    //         capacity: 1000,
    //         color: '#aaaaaa',
    //         user: 'something',
    //     });
    //     find = query.find((e) => e.id === '56d9bf92f9be48771d6fe5b4');
    //     expect(find).not.toBeUndefined();
    //     expect(find).toEqual({
    //         id: '56d9bf92f9be48771d6fe5b4',
    //         name: 'name other',
    //         capacity: 1000,
    //         color: '#aaaaaa',
    //         user: 'something',
    //     });
    // });

});
