import {
    VenueMessage as VM,
    VenueResponse as VR,
    VenueMessageValidator,
    VenueResponseValidator, VenueResponse
} from '@uems/uemscommlib';
import { Channel, connect, Connection, ConsumeMessage, Options } from 'amqplib';
import { createNanoEvents, Unsubscribe } from 'nanoevents';
import * as z from 'zod';
import { has } from '@uems/uemscommlib/build/utilities/ObjectUtilities';
import { constants } from 'http2';
import { _ml } from '../logging/Log';

import VenueMessage = VM.VenueMessage;
import VenueResponseMessage = VenueResponse.VenueResponseMessage;
import VenueReadResponseMessage = VenueResponse.VenueReadResponseMessage;
import { MessageValidator } from "@uems/uemscommlib/build/messaging/MessageValidator";

const __ = _ml(__filename);
const _a = _ml(`${__filename} | amqp`);

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

export type ConnectFunction = (url: string | Options.Connect, socketOptions?: any) => Promise<Connection>;
// Most basic abstraction
// - Connects to rabbitmq
// - Processes incoming messages
// - Validates content
// - Calls listeners

export abstract class AbstractBrokerHandler {

    /**
     * If this network handler currently has successfully configured connection to the rabbit mq server
     * @private
     */
    private _connected = false;

    /**
     * The open connection to the rabbit mq server
     * @private
     */
    protected _connection?: Connection;

    /**
     * The channel on which the responses should be made
     * @private
     */
    private _responseChannel?: Channel;

    /**
     * Handlers current waiting for a ready signal
     * @private
     */
    private _waitingForReady: ((...args: any) => void)[] = [];

    protected constructor(
        /**
         * The configuration used to setup the message broker including the queues names
         */
        private _configuration: MessagingConfiguration,
        /**
         * The validator which should be used to parse incoming messages received from the broker
         * @private
         */
        private _incomingValidator: MessageValidator,
        /**
         * The validator which should be used to parse outgoing messages from the clients
         * @private
         */
        private _outgoingValidator: MessageValidator,
        connectionMethod?: ConnectFunction,
    ) {
        (connectionMethod ?? connect)(_configuration.options).then((connection) => {
            this._connection = connection;
            return this.setupConnection();
        }).catch((err: unknown) => {
            if (err instanceof Error) {
                __.error('received an error via catch of amqplib connect', {
                    error: err,
                });

                void this.error(err);
            } else {
                __.error(`received an error via catch of amqplib connect but it did not match an instance of 
                an error. The error is logged here and an unknown error is being passed to the event handlers`, {
                    error: err,
                });

                void this.error(new Error('Unknown error on amqplib connection reject'));
            }
        });
    }

    public onReady = (x: ((...args: any) => void)): void => {
        if (this._connected) x();
        else {
            this._waitingForReady.push(x);
        }
    };

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

        void this.error(err);
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
            void this.error(Error('disconnected[close]'));
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
        this._waitingForReady.forEach((e) => e());
        void this.ready();
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

        if (!await this._incomingValidator.validate(content)) {
            __.error(`received an invalid message payload. it did not validate against the uemsCommsLib schema 
            definitions for incoming messages`, {
                content,
            });
            return;
        }

        const genericErrorHandler = (err: any) => {
            __.error('other handler failed and rejected', {
                error: err as unknown,
            });
            void this.error(new Error('generic handler rejects'));
        };

        if (has(content, 'msg_intention')) {
            switch (content.msg_intention) {
                case 'CREATE':
                    __.debug('got a create message');
                    Promise.resolve(this.create(content)).catch(genericErrorHandler);
                    break;
                case 'UPDATE':
                    __.debug('got an update message');
                    Promise.resolve(this.update(content)).catch(genericErrorHandler);
                    break;
                case 'DELETE':
                    __.debug('got a delete message');
                    Promise.resolve(this.delete(content)).catch(genericErrorHandler);
                    break;
                case 'READ':
                    __.debug('got a query message');
                    Promise.resolve(this.read(content)).catch(genericErrorHandler);
                    break;
                default:
                    __.debug('got an unknown message');
                    Promise.resolve(this.other(content)).catch(genericErrorHandler);
                    break;
            }
        } else {
            Promise.resolve(this.other(content)).catch(genericErrorHandler);
        }
    };

    protected async send(messageID: number, messageIntention: string, response: any) {
        if (!this._responseChannel) {
            __.error('got a response but the response channel is undefined?');
            return;
        }

        if (!await this._outgoingValidator.validate(response)) {
            __.error(`a response was submitted to the handler that did not validate against the provided 
            outgoing validator object. sending an error response to the parent instead`, {
                response: response as unknown,
            });

            this._responseChannel.publish(this._configuration.gateway, '', Buffer.from(JSON.stringify({
                msg_id: messageID,
                msg_intention: messageIntention,
                status: constants.HTTP_STATUS_INTERNAL_SERVER_ERROR,
            })));

            return;
        }

        this._responseChannel.publish(this._configuration.gateway, '', Buffer.from(JSON.stringify(response)));
    }

    protected abstract error(err?: any): void | PromiseLike<void> | Promise<void>;

    protected abstract ready(): void | PromiseLike<void> | Promise<void>;

    protected abstract create(message: Record<string, any>): void | PromiseLike<void> | Promise<void>;

    protected abstract delete(message: Record<string, any>): void | PromiseLike<void> | Promise<void>;

    protected abstract update(message: Record<string, any>): void | PromiseLike<void> | Promise<void>;

    protected abstract read(message: Record<string, any>): void | PromiseLike<void> | Promise<void>;

    protected abstract other(message: Record<string, any>): void | PromiseLike<void> | Promise<void>;
}

export class RabbitNetworkHandler extends AbstractBrokerHandler {

    /**
     * The event emitter supporting this network handler used to dispatch functions
     * @private
     */
    private _emitter = createNanoEvents<RabbitNetworkHandlerEvents>();

    constructor(configuration: MessagingConfiguration, connectionMethod?: ConnectFunction) {
        super(
            configuration,
            new VenueMessageValidator(),
            new VenueResponseValidator(),
            connectionMethod,
        );
    }

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
            void callback(...args);
        });

        return unbind;
    }

    /**
     * Handles a response from a a message handler validating the response and responding on the message broker to the
     * gateway. This should be used to generate callbacks for handlers.
     * @param venue the initial venue message that needs to be handled by this callback
     */
    private handleReply = (venue: VenueMessage) => (
        (response: VR.VenueResponseMessage | VR.VenueReadResponseMessage): void => {
            __.info(`got a response to message ${venue.msg_id} of status ${response.status}`);
            void super.send(venue.msg_id, venue.msg_intention, response);
        }
    );

    protected create(message: Record<string, any>): void | PromiseLike<void> | Promise<void> {
        const cast = message as (VM.CreateVenueMessage);
        this._emitter.emit('create', cast, this.handleReply(cast));
    }

    protected delete(message: Record<string, any>): void | PromiseLike<void> | Promise<void> {
        const cast = message as (VM.DeleteVenueMessage);
        this._emitter.emit('delete', cast, this.handleReply(cast));
    }

    protected update(message: Record<string, any>): void | PromiseLike<void> | Promise<void> {
        const cast = message as (VM.UpdateVenueMessage);
        this._emitter.emit('update', cast, this.handleReply(cast));
    }

    protected read(message: Record<string, any>): void | PromiseLike<void> | Promise<void> {
        const cast = message as (VM.ReadVenueMessage);
        this._emitter.emit('query', cast, this.handleReply(cast));
    }

    protected other(message: Record<string, any>): void | PromiseLike<void> | Promise<void> {
        const cast = message as (VM.VenueMessage);
        this._emitter.emit('any', cast, this.handleReply(cast));
    }

    protected ready(): void | PromiseLike<void> | Promise<void> {
        this._emitter.emit('ready');
    }

    protected error(err?: any): void | PromiseLike<void> | Promise<void> {
        this._emitter.emit('error', err);
    }

}
