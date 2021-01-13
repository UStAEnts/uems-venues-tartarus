import { constants } from 'http2';
import { MsgStatus, VenueMessage, VenueResponse } from '@uems/uemscommlib';
import { VenueDatabase } from '../database/Database';
import { RabbitNetworkHandler } from '../networking/Messaging';
import { _ml } from '../logging/Log';
import { ClientFacingError } from "@uems/micro-builder/build/errors/ClientFacingError";

const _b = _ml(__filename, 'binding');

async function execute(
    message: VenueMessage.VenueMessage,
    database: VenueDatabase | undefined,
    send: (res: VenueResponse.VenueResponseMessage | VenueResponse.VenueReadResponseMessage) => void,
) {
    if (!database) {
        _b.warn('query was received without a valid database connection');
        throw new Error('uninitialised database connection');
    }

    let status: number = constants.HTTP_STATUS_INTERNAL_SERVER_ERROR;
    let result: string[] | VenueResponse.InternalVenue[] = [];

    try {
        switch (message.msg_intention) {
            case 'CREATE':
                result = await database.create(message);
                status = MsgStatus.SUCCESS;
                break;
            case 'DELETE':
                result = await database.delete(message);
                status = MsgStatus.SUCCESS;
                break;
            case 'READ':
                result = await database.query(message);
                status = MsgStatus.SUCCESS;
                break;
            case 'UPDATE':
                result = await database.update(message);
                status = MsgStatus.SUCCESS;
                break;
            default:
                status = constants.HTTP_STATUS_NOT_IMPLEMENTED;
        }
    } catch (e) {
        _b.error('failed to query database for events', {
            error: e as unknown,
        });

        if (e instanceof ClientFacingError) {
            send({
                userID: message.userID,
                status: MsgStatus.FAIL,
                msg_intention: message.msg_intention,
                msg_id: message.msg_id,
                result: [e.message],
            });
        } else {
            send({
                userID: message.userID,
                status: constants.HTTP_STATUS_INTERNAL_SERVER_ERROR,
                msg_intention: message.msg_intention,
                msg_id: message.msg_id,
                result: ['internal server error'],
            });
        }
        return;
    }

    if (message.msg_intention === 'READ') {
        send({
            msg_intention: message.msg_intention,
            msg_id: message.msg_id,
            status,
            result: result as VenueResponse.InternalVenue[],
            userID: message.userID,
        });
    } else {
        send({
            msg_intention: message.msg_intention,
            msg_id: message.msg_id,
            status,
            result: result as string[],
            userID: message.userID,
        });
    }
}

export default function bind(database: VenueDatabase, broker: RabbitNetworkHandler): void {
    broker.on('query', (message, send) => execute(message, database, send));
    _b.debug('bound [query] event');

    broker.on('delete', (message, send) => execute(message, database, send));
    _b.debug('bound [delete] event');

    broker.on('update', (message, send) => execute(message, database, send));
    _b.debug('bound [update] event');

    broker.on('create', (message, send) => execute(message, database, send));
    _b.debug('bound [create] event');
}
