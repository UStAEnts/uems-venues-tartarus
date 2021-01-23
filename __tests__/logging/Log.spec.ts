/* eslint-disable */
import winston from "winston";
import { has } from "@uems/uemscommlib";
import { Writable } from "stream";

/**
 * A utility stream which writes to an internal buffer instead and allows it to be accessed as a string
 */
class TestingStream extends Writable {

    /**
     * Holds the current contents of this stream until it is reset
     * @private
     */
    private _currentContents = '';

    /**
     * Writes the given chunk to the internal buffer and returns true
     * @param chunk
     */
    write(chunk: any): boolean {
        this._currentContents += chunk.toString();
        return true;
    }

    /**
     * Writes the given chunk to the internal buffer
     * @param chunk the chunk to be included in the buffer converted to a string
     * @param encoding the encoding of this buffer (ignored)
     * @param callback the callback (ignored)
     */
    _write(chunk: any, encoding: BufferEncoding, callback: (error?: (Error | null)) => void) {
        this._currentContents += chunk.toString();
    }

    /**
     * Returns the current contents of the buffer
     * @returns the accumulated content of the buffer
     */
    public getContent() {
        return this._currentContents;
    }

    /**
     * Clears the current buffer
     */
    public clear() {
        this._currentContents = '';
    }
}

describe('Log.ts', () => {
    beforeEach(() => {
        // Reset back to a dev environment before each test and re-enable the no file setting so we don't produce
        // unnecessary log files.
        process.env.NODE_ENV = 'dev';
        process.env.UEMS = 'NO_FILE';
    })

    afterEach(() => {
        // After each test reset the modules so we can update the environment variables and adjust the logger
        // construction
        jest.resetModules();
    })

    it('should return a valid logger when called with a label', () => {
        const { _ml } = require('../../src/logging/Log');

        expect(_ml()).not.toBeNull();
        expect(_ml()).not.toBeUndefined();
    });

    it('should only attach a console transport when in debug environment', () => {

        const { _ml } = require('../../src/logging/Log');
        const logger = _ml();

        expect(logger.transports.find((e: any) => has(e, 'name') && e.name === 'console')).not.toBeUndefined();
        expect(logger.transports.find((e: any) => has(e, 'name') && e.name === 'file')).toBeUndefined();
    });

    it('should only attach a file transport when in debug environment', () => {
        process.env.NODE_ENV = 'prod';
        process.env.UEMS = '';

        const { _ml } = require('../../src/logging/Log');
        const logger = _ml();

        expect(logger.transports.find((e: any) => has(e, 'name') && e.name === 'console')).toBeUndefined();
        expect(logger.transports.find((e: any) => has(e, 'name') && e.name === 'file')).not.toBeUndefined();

        process.env.UEMS = 'NO_FILE';
    });

    it('should include metadata in the output', () => {
        const { _ml, prettyFormat } = require('../../src/logging/Log');
        const stream = new TestingStream();
        const logger = _ml('LOG_LABEL')

        logger.configure({
            transports: [new winston.transports.Stream({
                stream,
                level: 'silly',
                format: prettyFormat,
            })],
        });

        logger.info('TESTING_MESSAGE', {
            'VALUE_A': 'VALUE_B',
        });

        expect(stream.getContent()).toContain('TESTING_MESSAGE');
        expect(stream.getContent()).toContain('info');
        expect(stream.getContent()).toContain('[VALUE_A]: \'VALUE_B\'');
        stream.clear();
    });

    it('should format log messages to include labels', () => {
        const { _ml, prettyFormat } = require('../../src/logging/Log');
        const stream = new TestingStream();
        const logger = _ml('LOG_LABEL')

        logger.configure({
            transports: [new winston.transports.Stream({
                stream,
                level: 'silly',
                format: prettyFormat,
            })],
        });

        for (const level of ['error', 'warn', 'info', 'verbose', 'debug', 'silly']) {
            logger[level](`LOG_MESSAGE-${level}`);
            expect(stream.getContent()).toContain(level);
            expect(stream.getContent()).toContain('LOG_LABEL');
            expect(stream.getContent()).toContain(`LOG_MESSAGE-${level}`);
            stream.clear();
        }
    });

    it('should format log messages to include levels', () => {
        const { _ml, prettyFormat } = require('../../src/logging/Log');
        let logger = _ml();
        const stream = new TestingStream();

        logger.configure({
            transports: [],
        });
        logger.add(new winston.transports.Stream({
            stream,
            format: prettyFormat,
            level: 'silly',
        }));

        for (const level of ['error', 'warn', 'info', 'verbose', 'debug', 'silly']) {
            logger[level](`LOG_MESSAGE-${level}`);
            expect(stream.getContent()).toContain(level);
            expect(stream.getContent()).toContain(`LOG_MESSAGE-${level}`);
            stream.clear();
        }
    })
});
