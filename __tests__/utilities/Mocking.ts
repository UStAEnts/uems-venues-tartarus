import { Connection, MessageFields, MessageProperties, Options, Replies } from "amqplib";
import { ConsumeMessage, GetMessage, Message } from "amqplib/properties";
import { EventEmitter } from "events";
import Consume = Replies.Consume;
import Publish = Options.Publish;
import { ConnectFunction } from "../../src/networking/Messaging";

export function createTest() {
    const connection = new MessagingConnection();
    const func: ConnectFunction = () => Promise.resolve(connection) as unknown as Promise<Connection>;

    return {
        connection,
        connect: func,
    }
}

export class MessagingChannel {

    private _listeners: Record<string, ((msg: ConsumeMessage | null) => any)[]> = {};

    constructor(
        private _connection: MessagingConnection,
    ) {
    }

    assertExchange(name: string, type: string, options?: any) {
        return Promise.resolve();
    }

    assertQueue(name: string, options?: any) {
        return Promise.resolve({
            queue: name,
            messageCount: 0,
            consumerCount: 0,
        });
    }

    bindQueue(name: string, pattern: string, args?: any) {
        return Promise.resolve();
    }

    consume(queue: string, onMessage: (msg: ConsumeMessage | null) => any, options?: Consume) {
        console.log('consiming?', queue);
        if (this._listeners.hasOwnProperty(queue)) {
            this._listeners[queue].push(onMessage);
        } else {
            this._listeners[queue] = [
                onMessage,
            ];
        }
        return Promise.resolve();
    }

    publish(exchange: string, routingKey: string, data: Buffer, options?: Publish) {
        this._connection.$receive(new MessagingMessage(exchange, routingKey, data, options));
        return Promise.resolve();
    }

    $send(queue: string, message: ConsumeMessage) {
        if (this._listeners.hasOwnProperty(queue)) {
            this._listeners[queue].forEach((e) => e(message));
        }
    }

}

export class MessagingMessage {

    constructor(
        private _exchange: string,
        private _routing: string,
        private _data: Buffer,
        private _options?: Publish,
    ) {
    }

    get exchange(): string {
        return this._exchange;
    }

    get routing(): string {
        return this._routing;
    }

    get data(): Buffer {
        return this._data;
    }

    get options(): Options.Publish | undefined {
        return this._options;
    }
}

export class MessagingConnection {

    private _channels: MessagingChannel[] = [];
    private _messages: MessagingMessage[] = [];
    private _emitter = new EventEmitter();
    private _listeners: Record<string, ((...args: any[]) => any)[]> = {};

    on(event: string, handler: (...args: any[]) => any): void {
        if (this._listeners.hasOwnProperty(event)) {
            this._listeners[event].push(handler);
        } else {
            this._listeners[event] = [handler];
        }
    }

    async createChannel(): Promise<MessagingChannel> {
        const channel = new MessagingChannel(this);
        this._channels.push(channel);
        return channel;
    }

    $messages(consume: boolean): MessagingMessage[] {
        if (consume) {
            const clone = [...this._messages];
            this._messages = [];
            return clone;
        }

        return this._messages;
    }

    $receive(message: MessagingMessage) {
        this._messages.push(message);
    }

    $send(queue: string, message: ConsumeMessage) {
        this._channels.forEach((e) =>
            e.$send(queue, message)
        );
    }

    $sendSimple(queue: string, message: string) {
        this.$send(queue, {
            content: Buffer.from(message),
            fields: {} as MessageFields,
            properties: {} as MessageProperties,
        });
    }

    $error(data: any) {
        if (this._listeners.hasOwnProperty('error')) this._listeners['error'].forEach((e) => {
            e(data)
        });
    }

    $close() {
        if (this._listeners.hasOwnProperty('close')) this._listeners['close'].forEach((e) => e());
    }

    $block() {
        if (this._listeners.hasOwnProperty('blocked')) this._listeners['blocked'].forEach((e) => e());
    }

    $unblock() {
        if (this._listeners.hasOwnProperty('unblocked')) this._listeners['unblocked'].forEach((e) => e());
    }

}
