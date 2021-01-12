import { VenueMessage } from "@uems/uemscommlib";

process.env.NODE_ENV = 'dev';
import { AbstractBrokerHandler, ConnectFunction, RabbitNetworkHandler } from "../../src/networking/Messaging";
import { MessageValidator } from "@uems/uemscommlib/build/messaging/MessageValidator";
import { createTest, MessagingConnection } from '../utilities/Mocking';
import { has } from "@uems/uemscommlib/build/utilities/ObjectUtilities";
import { MessageFields, MessageProperties } from "amqplib";
import CreateVenueMessage = VenueMessage.CreateVenueMessage;
import DeleteVenueMessage = VenueMessage.DeleteVenueMessage;
import ReadVenueMessage = VenueMessage.ReadVenueMessage;
import UpdateVenueMessage = VenueMessage.UpdateVenueMessage;

const configuration = {
    gateway: 'gateway',
    inbox: 'inbox',
    request: 'request',
    topics: [],
    options: {},
};

const generateTestMessage = (type: 'delete' | 'read' | 'update' | 'create') => {
    switch (type) {
        case "create":
            return {
                msg_id: 0,
                msg_intention: 'CREATE',
                userID: 'anonymous',
                status: 0,
                name: 'a',
                capacity: 10,
                userid: 'anonymous',
                color: '#aeaeae',
            } as CreateVenueMessage
        case "delete":
            return {
                msg_id: 0,
                msg_intention: 'DELETE',
                status: 0,
                userID: 'anonymous',
                id: "abc",
            } as DeleteVenueMessage
        case "read":
            return {
                msg_id: 0,
                msg_intention: 'READ',
                userID: 'anonymous',
                status: 0,
                name: "abc",
            } as ReadVenueMessage
        case "update":
            return {
                msg_id: 0,
                msg_intention: 'UPDATE',
                status: 0,
                userID: 'anonymous',
                name: "abc",
                id: "abc",
            } as UpdateVenueMessage
    }
}

class X extends MessageValidator {


    constructor(private _validate: (a: any) => boolean) {
        super({});
    }

    validate(msg: any): Promise<boolean> {
        return Promise.resolve(this._validate(msg));
    }
}

class TestingBroker extends AbstractBrokerHandler {

    constructor(
        validateIncoming: (a: any) => boolean,
        validateOutgoing: (a: any) => boolean,
        connect: ConnectFunction,
        onReady?: () => void,
    ) {
        super(
            configuration,
            new X(validateIncoming),
            new X(validateOutgoing),
            connect,
        );

        if (onReady) {
            // @ts-ignore
            this.ready = onReady;
        }
    }

    public accessSend = (messageID: number, msgIntention: string, response: any) => this.send(messageID, msgIntention, response);

    public create = jest.fn();
    public delete = jest.fn();
    public error = jest.fn();
    public other = jest.fn();
    public read = jest.fn();
    public ready = jest.fn();
    public update = jest.fn();

}

const promisifiedTimeout = (timeout: number) => (new Promise((resolve) => {
    setTimeout(resolve, timeout);
}));

jest.setTimeout(20000);

describe('Messaging.ts', () => {
    describe('AbstractBrokerHandler', () => {
        let testConnection: MessagingConnection;
        let funcConnection: ConnectFunction;

        beforeEach(() => {
            const { connect, connection } = createTest();

            funcConnection = connect;
            testConnection = connection;
        });

        it('should call error on an error from the connection', (done) => {
            const broker = new TestingBroker(() => true, () => true, funcConnection);

            setTimeout(() => {
                testConnection.$error('');

                expect(broker.error).toHaveBeenCalled();
                done();
            }, 1000);
        });

        it('should ignore messages that dont match the validator', (done) => {
            const broker = new TestingBroker((m) => has(m, 'pass'), () => true, funcConnection);
            broker.onReady(() => {
                expect(broker.create).not.toHaveBeenCalled();
                expect(broker.delete).not.toHaveBeenCalled();
                expect(broker.update).not.toHaveBeenCalled();
                expect(broker.read).not.toHaveBeenCalled();
                expect(broker.other).not.toHaveBeenCalled();

                testConnection.$send('inbox', {
                    content: Buffer.from(JSON.stringify({
                        pass: '',
                        msg_intention: 'CREATE',
                    })),
                    properties: {} as MessageProperties,
                    fields: {} as MessageFields,
                });

                testConnection.$send('inbox', {
                    content: Buffer.from(JSON.stringify({
                        msg_intention: 'CREATE',
                    })),
                    properties: {} as MessageProperties,
                    fields: {} as MessageFields,
                });

                setTimeout(() => {
                    expect(broker.create).toHaveBeenCalledTimes(1);
                    done();
                }, 1000);
            });
        });

        it('should not crash on a malformed message', (done) => {
            const broker = new TestingBroker((m) => has(m, 'pass'), () => true, funcConnection);
            broker.onReady(() => {
                testConnection.$send('inbox', {
                    content: Buffer.from('{invalidjson'),
                    properties: {} as MessageProperties,
                    fields: {} as MessageFields,
                });

                setTimeout(() => {
                    expect(broker.create).not.toHaveBeenCalled();
                    expect(broker.delete).not.toHaveBeenCalled();
                    expect(broker.update).not.toHaveBeenCalled();
                    expect(broker.read).not.toHaveBeenCalled();
                    expect(broker.other).not.toHaveBeenCalled();

                    done();
                }, 1000);
            });
        });

        it('should not crash on a crashing handler', (done) => {
            const broker = new TestingBroker((m) => true, () => true, funcConnection);

            broker.create = broker.create.mockRejectedValue(undefined);

            broker.onReady(() => {
                testConnection.$send('inbox', {
                    content: Buffer.from('{"msg_intention": "CREATE"}'),
                    properties: {} as MessageProperties,
                    fields: {} as MessageFields,
                });

                setTimeout(() => {
                    expect(broker.create).toHaveBeenCalledTimes(1);
                    expect(broker.delete).not.toHaveBeenCalled();
                    expect(broker.update).not.toHaveBeenCalled();
                    expect(broker.read).not.toHaveBeenCalled();
                    expect(broker.other).not.toHaveBeenCalled();
                    expect(broker.error).toHaveBeenCalledTimes(1);

                    done();
                }, 1000);
            });
        });

        it('should call the respective handlers', (done) => {
            const broker = new TestingBroker((m) => true, () => true, funcConnection);

            broker.onReady(() => {


                testConnection.$send('inbox', {
                    content: Buffer.from('{"msg_intention": "CREATE"}'),
                    properties: {} as MessageProperties,
                    fields: {} as MessageFields,
                });

                promisifiedTimeout(1000).then(() => {
                    expect(broker.create).toHaveBeenCalledTimes(1);

                    testConnection.$sendSimple('inbox', '{"msg_intention": "DELETE"}');
                    return promisifiedTimeout(500);
                }).then(() => {
                    expect(broker.delete).toHaveBeenCalledTimes(1);

                    testConnection.$sendSimple('inbox', '{"msg_intention": "UPDATE"}');
                    return promisifiedTimeout(500);
                }).then(() => {
                    expect(broker.update).toHaveBeenCalledTimes(1);

                    testConnection.$sendSimple('inbox', '{"msg_intention": "READ"}');
                    return promisifiedTimeout(500);
                }).then(() => {
                    expect(broker.read).toHaveBeenCalledTimes(1);

                    testConnection.$sendSimple('inbox', '{"msg_intention": "INVALID"}');
                    return promisifiedTimeout(500);
                }).then(() => {
                    expect(broker.other).toHaveBeenCalledTimes(1);

                    testConnection.$sendSimple('inbox', '{}');
                    return promisifiedTimeout(500);
                }).then(() => {
                    expect(broker.other).toHaveBeenCalledTimes(2);
                }).then(done)
            });
        });

        it('should reject outgoing messages if malformed', (done) => {
            // Always reject outgoing messages
            const broker = new TestingBroker(() => true, () => false, funcConnection);

            broker.onReady(() => {
                expect(testConnection.$messages(false).length).toEqual(0);

                broker.accessSend(0, 'intention', {});

                promisifiedTimeout(1000).then(() => {
                    expect(testConnection.$messages(false).length).toEqual(1);

                    const [message] = testConnection.$messages(true);
                    expect(message).not.toBeUndefined();

                    const content = JSON.parse(message.data.toString())
                    console.log(content);
                    expect(content).toHaveProperty('msg_id', 0);
                    expect(content).toHaveProperty('msg_intention', 'intention');
                    expect(content).toHaveProperty('status', 500);

                    done();
                })
            });
        });

        it('should publish valid messages', (done) => {
            // Always accept outgoing messages
            const broker = new TestingBroker(() => true, () => true, funcConnection);

            broker.onReady(() => {
                expect(testConnection.$messages(false).length).toEqual(0);

                broker.accessSend(0, 'intention', {
                    someKey: true,
                    status: 200,
                    msg_id: 0,
                    msg_intention: 'intention',
                });

                promisifiedTimeout(1000).then(() => {
                    expect(testConnection.$messages(false).length).toEqual(1);

                    const [message] = testConnection.$messages(true);
                    expect(message).not.toBeUndefined();

                    const content = JSON.parse(message.data.toString())
                    console.log(content);
                    expect(content).toHaveProperty('msg_id', 0);
                    expect(content).toHaveProperty('msg_intention', 'intention');
                    expect(content).toHaveProperty('status', 200);
                    expect(content).toHaveProperty('someKey', true);

                    done();
                })
            });
        });

        it('should call error if the connection fails to connect', (done) => {
            let broker = new TestingBroker(() => true, () => true, () => Promise.reject());
            promisifiedTimeout(1000).then(() => {
                expect(broker.error).toHaveBeenCalledTimes(1);
                expect(broker.error.mock.calls[0][0]).toHaveProperty('message');
                expect(broker.error.mock.calls[0][0].message).toContain('Unknown error');
            }).then(() => {
                broker = new TestingBroker(() => true, () => true, () => Promise.reject(new Error('x')));
                return promisifiedTimeout(1000);
            }).then(() => {
                expect(broker.error).toHaveBeenCalledTimes(1);
                expect(broker.error.mock.calls[0][0]).toHaveProperty('message');
                expect(broker.error.mock.calls[0][0].message).toContain('x');
                done();
            });
        });
    });

    describe('RabbitNetworkHandler', () => {
        let testConnection: MessagingConnection;
        let funcConnection: ConnectFunction;
        let broker: RabbitNetworkHandler;

        beforeEach(() => {
            const { connect, connection } = createTest();

            funcConnection = connect;
            testConnection = connection;
            broker = new RabbitNetworkHandler(configuration, funcConnection);
        })

        it('should submit a fail message to the parent when invalid', (done) => {
            broker.onReady(() => {
                broker.once('update', (message, send) => {
                    // @ts-ignore
                    send({
                        result: [],
                        msg_intention: 'READ',
                    });

                    promisifiedTimeout(1000).then(() => {
                        expect(testConnection.$messages(false)).toHaveLength(1);

                        let [message] = testConnection.$messages(true);
                        expect(message).not.toBeUndefined();

                        // @ts-ignore
                        message = JSON.parse(message.data);

                        expect(message).toHaveProperty('status', 500);

                        done();
                    });
                });

                testConnection.$sendSimple('inbox', JSON.stringify(generateTestMessage('update')));
            });
        });

        it('should submit messages to the parent when valid', (done) => {
            broker.onReady(() => {
                broker.once('update', (message, send) => {
                    send({
                        result: [],
                        status: 100,
                        msg_id: 0,
                        userID: 'anonymous',
                        msg_intention: 'READ',
                    });

                    promisifiedTimeout(1000).then(() => {
                        expect(testConnection.$messages(false)).toHaveLength(1);
                        done();
                    });
                });

                testConnection.$sendSimple('inbox', JSON.stringify(generateTestMessage('update')));
            });
        });

        it('should only call a once handler once', (done) => {
            broker.onReady(() => {
                const update = jest.fn();
                broker.once('update', update);

                testConnection.$sendSimple('inbox', JSON.stringify(generateTestMessage('update')));
                promisifiedTimeout(1000).then(() => {
                    expect(update).toHaveBeenCalledTimes(1);
                    testConnection.$sendSimple('inbox', JSON.stringify(generateTestMessage('update')));
                    return promisifiedTimeout(1000);
                }).then(() => {
                    expect(update).toHaveBeenCalledTimes(1);
                    done();
                })
            });
        });

        it('should call the respective handlers', (done) => {
            broker.onReady(() => {

                const update = jest.fn();
                const remove = jest.fn();
                const read = jest.fn();
                const create = jest.fn();
                const error = jest.fn();
                const any = jest.fn();

                broker.on('update', update);
                broker.on('delete', remove);
                broker.on('query', read);
                broker.on('create', create);
                broker.on('error', error);
                broker.on('any', any);


                testConnection.$sendSimple('inbox', JSON.stringify(generateTestMessage('update')));
                promisifiedTimeout(1000).then(() => {
                    expect(update).toHaveBeenCalledTimes(1);
                    testConnection.$sendSimple('inbox', JSON.stringify(generateTestMessage('create')));
                    return promisifiedTimeout(1000);
                }).then(() => {
                    expect(create).toHaveBeenCalledTimes(1);
                    testConnection.$sendSimple('inbox', JSON.stringify(generateTestMessage('delete')));
                    return promisifiedTimeout(1000);
                }).then(() => {
                    expect(remove).toHaveBeenCalledTimes(1);
                    testConnection.$sendSimple('inbox', JSON.stringify(generateTestMessage('read')));
                    return promisifiedTimeout(1000);
                }).then(() => {
                    expect(read).toHaveBeenCalledTimes(1);
                    testConnection.$error(new Error('failed'));
                    return promisifiedTimeout(1000);
                }).then(() => {
                    expect(error).toHaveBeenCalledTimes(1);
                    done();
                })
            });
        });
    })
})
