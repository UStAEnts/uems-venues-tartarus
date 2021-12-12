import { Connection, Options } from 'amqplib';
import * as z from 'zod';

const OptionType: z.ZodType<Options.Connect> = z.any().optional();

/**
 * The scheme which should be used to validate messaging configurations before casting them
 */
export const MessagingConfigurationSchema = z.object({
    options: OptionType,
    gateway: z.string(),
    request: z.string(),
    inbox: z.string(),
    topics: z.array(z.string()),
});
export type ConnectFunction = (url: string | Options.Connect, socketOptions?: any) => Promise<Connection>;
