import {
    VenueMessage as VM,
    VenueResponse as VR,
    VenueMessageValidator,
    VenueResponseValidator
} from '@uems/uemscommlib';
import { connect, Connection, ConsumeMessage, Options } from 'amqplib';
import { createNanoEvents, Unsubscribe } from 'nanoevents';
import { _ml } from '../logging/Log';
import * as z from 'zod';

import VenueMessage = VM.VenueMessage;
import VenueResponse = VR.VenueResponseMessage;
import { Database, VenueDatabase } from "../database/Database";

const __ = _ml(__filename);
const _a = _ml(`${__filename}.amqp`);

const OptionType: z.ZodType<Options.Connect> = z.any().optional();

/**
 * The schem which should be used to validate messaging configurations before casting them
 */
export const MessagingConfigurationSchema = z.object({
    options: OptionType,
    gateway: z.string(),
    request: z.string(),
    inbox: z.string(),
    topics: z.array(z.string()),
});

/**
 * The inferred type of the schema for messaging configurations. See {@link MessagingConfigurationSchema} for details
 * of the type.
 */
export type MessagingConfiguration = z.infer<typeof MessagingConfigurationSchema>;

/**
 * Defines the interface of events dispatched by the message handler. This is used to inform the event handlers
 */
interface RabbitNetworkHandlerEvents {
    ready: () => void,
    create: (
        message: VM.CreateVenueMessage,
        send: (res: VenueResponseMessage | VenueReadResponseMessage) => void,
    ) => void | Promise<void>,
    delete: (
        message: VM.DeleteVenueMessage,
        send: (res: VenueResponseMessage | VenueReadResponseMessage) => void,
    ) => void | Promise<void>,
    query: (
        message: VM.ReadVenueMessage,
        send: (res: VenueResponseMessage | VenueReadResponseMessage) => void,
    ) => void | Promise<void>,
    update: (
        message: VM.UpdateVenueMessage,
        send: (res: VenueResponseMessage | VenueReadResponseMessage) => void,
    ) => void | Promise<void>,
    any: (
        message: VenueMessage,
        send: (res: VenueResponseMessage | VenueReadResponseMessage) => void,
    ) => void | Promise<void>,
    error: (
        error: Error,
    ) => void,
}

/**
 * A handler for messages received from the rabbit mq message broker and dispatching them via event emitters.
 */
export class RabbitNetworkHandler {

    /**
     * The event emitter supporting this network handler used to dispatch functions
     * @private
     */
    private _emitter = createNanoEvents<RabbitNetworkHandlerEvents>();

    /**
     * If this network handler currently has successfully configured connection to the rabbit mq server
     * @private
     */
    private _connected = false;

    /**
     * The open connection to the rabbit mq server
     * @private
     */
    private _connection?: Connection;

    private _responseChannel?: Channel;

    /**
     * The message validator which should be used to validate incoming messages
     * @private
     */
    private readonly MESSAGE_VALIDATOR = new VenueMessageValidator();

    /**
     * The message validator which should be used for validating outgoing messages
     * @private
     */
    private readonly RESPONSE_VALIDATOR = new VenueResponseValidator();

    constructor(
        /**
         * The configuration used to setup the message broker including the queues names
         */
        private _configuration: MessagingConfiguration,
    ) {
        connect(_configuration.options).then((connection) => {
            this._connection = connection;
            return this.setupConnection();
        }).catch((err: unknown) => {
            if (err instanceof Error) {
                __.error('received an error via catch of amqplib connect', {
                    error: err,
                });

                this._emitter.emit('error', err);
            } else {
                __.error(`received an error via catch of amqplib connect but it did not match an instance of 
                an error. The error is logged here and an unknown error is being passed to the event handlers`, {
                    error: err,
                });

                this._emitter.emit('error', new Error('Unknown error on amqplib connection reject'));
            }
        });
    }

    /**
     * Logs the error submitted on the amqplib logger and outputs special messages in the case of a connection closing
     * @param err the error raised by the connection
     */
    private connectionErrorHandler = (err: Error) => {
        _a.error('an error was raised by the amqplib connection', {
            error: err,
        });

        if (err.message === 'Connection closing') {
            _a.warn('connection closing message received, this should be handled by the close handler');
        }
    };

    /**
     * Configures the connection the rabbitmq broker by attaching error handlers, message handlers and ensuring that
     * this class is attached to all the channels as defined in the configuration.
     */
    private setupConnection = async () => {
        if (!this._connection) {
            __.error('setup connection was called with a falsy connection value. This should not happen!');
            throw new Error('invalid connection parameter');
        }
        _a.debug('valid connection received, beginning setup and listener attachment');

        this._connection.on('error', this.connectionErrorHandler);
        this._connection.on('close', () => {
            this._connected = false;
            _a.warn('disconnected from the message broker due to a close event being received on the connection');
        });

        _a.debug('event listeners configured');

        // Ensure that the gateway exchange exists
        this._responseChannel = await this._connection.createChannel();
        await this._responseChannel.assertExchange(this._configuration.gateway, 'direct');

        _a.debug('response exchange created');

        // Ensure the request exchange exists
        const requestChannel = await this._connection.createChannel();
        await requestChannel.assertExchange(this._configuration.request, 'topic', {
            durable: false,
        });

        _a.debug('request exchange created');

        // Ensure that the inbox queue exists. It shouldn't be exclusive in the case of multiple microservices
        const inbox = await requestChannel.assertQueue(this._configuration.inbox, {
            exclusive: false,
        });

        _a.debug('inbox created');

        // Bind the queue to all messages with the requested topics. This ensures we only answer messages destined for
        // this service. As this is an async function and we could have many topics, we want to wait until all of them
        // have been bound
        await Promise.all(
            this._configuration.topics.map((topic) => requestChannel.bindQueue(
                inbox.queue,
                this._configuration.request,
                topic,
            )),
        );

        _a.debug(`bound ${this._configuration.topics.length} topics to the inbox queue`);

        await requestChannel.consume(inbox.queue, this.handleIncoming, {
            noAck: true,
        });

        _a.debug('consumer attached, ready to receive');

        this._connected = true;
        this._emitter.emit('ready');
    };

    /**
     * Handles incoming messages and dispatches them to their listeners on the event and waits for a response
     * @param message the message received from the message broker
     */
    private readonly handleIncoming = async (message: ConsumeMessage | null): Promise<void> => {
        if (message === null) {
            _a.warn('received a null message from the inbox queue. ignoring');
            _a.warn('this suggests this consumer has been cancelled by RabbitMQ');
            return;
        }

        let content: Record<string, unknown>;

        // Try parsing as JSON but raise an error if that fails, we can only accept perfect messages
        try {
            content = JSON.parse(message.content.toString()) as typeof content;
        } catch (e) {
            __.error(`received an invalid message payload. an error was raised when attempting to parse the 
            content as json`, {
                error: e as unknown,
            });
            return;
        }

        if (!await this.MESSAGE_VALIDATOR.validate(content)) {
            __.error(`received an invalid message payload. it did not validate against the uemsCommsLib schema 
            definitions for incoming messages`, {
                content,
            });
            return;
        }

        // We now know that the message is safe!
        const venue: VM.VenueMessage = content as VM.VenueMessage;

        // Dispatch it out to the handlers and then wait for a reply
        switch (venue.msg_intention) {
            case 'CREATE':
                __.debug('got a create message');
                this._emitter.emit('create', venue, this.handleEventReply(venue));
                break;
            case 'UPDATE':
                __.debug('got an update message');
                this._emitter.emit('update', venue, this.handleEventReply(venue));
                break;
            case 'DELETE':
                __.debug('got a delete message');
                this._emitter.emit('delete', venue, this.handleEventReply(venue));
                break;
            case 'READ':
                __.debug('got a query message');
                this._emitter.emit('query', venue, this.handleEventReply(venue));
                break;
            default:
                __.debug('got an unknown message');
                this._emitter.emit('any', venue, this.handleEventReply(venue));
                break;
        }
    };

    /**
     * Handles a response from a a message handler validating the response and responding on the message broker to the
     * gateway. This should be used to generate callbacks for handlers.
     * @param venue the initial venue message that needs to be handled by this callback
     */
    private handleEventReply = (venue: VenueMessage) => (
        (response: VR.VenueResponseMessage | VR.VenueReadResponseMessage): void => {
            __.info(`got a response to message ${venue.msg_id} of status ${response.status}`);

            if (!this._responseChannel) {
                __.error('got a response but the response channel is undefined?');
                return;
            }

            this._responseChannel.publish(this._configuration.gateway, '', Buffer.from(JSON.stringify(response)));
        }
    );

    /**
     * Attaches an event listener to the underlying event emitter used by this network handler
     * @param event the event on which this listener should listen
     * @param callback the callback to be executed when the event is emitted
     */
    public on<E extends keyof RabbitNetworkHandlerEvents>(
        event: E,
        callback: RabbitNetworkHandlerEvents[E],
    ): Unsubscribe {
        return this._emitter.on(event, callback);
    }

    public once<E extends keyof RabbitNetworkHandlerEvents>(
        event: E,
        callback: RabbitNetworkHandlerEvents[E],
    ) {
        const unbind = this._emitter.on(event, (...args: any[]) => {
            unbind();

            // @ts-ignore
            callback(...args);
        });

        return unbind;
    }

}
