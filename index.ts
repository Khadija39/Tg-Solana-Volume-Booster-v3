import "dotenv/config";
import * as mongodb from "mongodb";
import TelegramBot from 'node-telegram-bot-api';
import { User } from "./telegramUI/types/user";
import { errorLOG, GENERIC_ERROR_MESSAGE, informationsLOG, successLOG } from "./telegramUI/utils/logs";
import { startCommand } from "./telegramUI/commands/start";
import { addWalletCallback, genWalletCallback, importWalletCallback, refreshWalletCallback, removeWalletCallback, removeWalletIndexCallback, walletCallback, walletInfoCallback, walletInfoIndexCallback } from "./telegramUI/callbacks/wallets";
import { botRunningCallback, InputTokenAddr } from "./telegramUI/callbacks/settings";
import { start } from "./volume";
import { getBalance } from "./telegramUI/utils/utils";
import { publicKey } from "@raydium-io/raydium-sdk";
import { PublicKey } from "@solana/web3.js";
import { gather } from "./gather";
const token = process.env.TELEGRAM_BOT_TOKEN as string;
export const bot = new TelegramBot(token, { polling: true });

const mongoUri = process.env.MONGODB_URI as string;
const client = new mongodb.MongoClient(mongoUri);

const dbName = process.env.MONGODB_DB_NAME as string;
const usersCollectionName = process.env.MONGODB_COLLECTION_NAME as string;
const commandList = [
    { command: "start", description: "Start the bot" },
    { command: "wallets", description: "This is to see ur main wallet." },
    { command: "gather", description: "collecting sol from subwallets to main wallets" },
    { command: "settings", description: "You can change trading parameters." },
];

const now: Date = new Date();
let botName: string;
bot.getMe().then((user) => {
    botName = user.username!.toString();
});
bot.setMyCommands(commandList);

async function getOrCreateUser(
    chatId: number,
    name: string,
    usersCollection: mongodb.Collection
): Promise<User | null> {
    let user = (await usersCollection.findOne({ id: chatId })) as User | null;

    if (!user) {
        await usersCollection.insertOne({
            id: chatId,
            username: name,
            wallets: [],
            subWallets: [],
            tokenAddr: '',  // Default or initial value
            boostedVolume: 0,
            status: false,
        } as User);

        // Fetch the newly inserted user
        user = (await usersCollection.findOne({ id: chatId })) as User | null;
    }

    return user;
}

async function main() {
    try {
        console.log(`${informationsLOG} Connecting to MongoDB...`);
        await client.connect();
        console.log(`${successLOG} Connected to MongoDB...`);
        const db = client.db(dbName);
        const usersCollection = db.collection(usersCollectionName);
        await usersCollection.createIndex({ id: 1 }, { unique: true });

        console.log(`${informationsLOG} Setting up bot...`);

        bot.on("message", async (msg: TelegramBot.Message) => {
            try {
                if (!msg.text) return;

                const chatId = msg.chat.id;
                const name = msg.from?.username!;
                const text = msg.text;

                let user: any;
                switch (text) {
                    case "/start":
                        console.log(
                            msg.from?.username,
                            "start volume bot : ",
                            now.toString()
                        );
                        startCommand(msg, bot);
                        break;

                    //TODO

                    default:
                        break;
                }
            } catch (error) {
                const chatId = msg.chat.id;
                console.error(`${errorLOG} ${error}`);
            }
        });

        bot.on("callback_query", async (callbackQuery) => {
            try {
                const message = callbackQuery.message;

                if (!message) return;

                const chatId = message.chat.id;
                const username = message.chat?.username!;
                const data = callbackQuery.data;

                if (!data) return;

                const user = await getOrCreateUser(chatId, username, usersCollection);

                if (!user) {
                    console.error(`${errorLOG} User not found.`);
                    return;
                }

                //TODO

                bot.answerCallbackQuery(callbackQuery.id);
            } catch (error) {
                if (!callbackQuery.message) return;

                const chatId = callbackQuery.message.chat.id;
                console.error(`${errorLOG} ${error}`);
                bot.sendMessage(chatId, GENERIC_ERROR_MESSAGE, {
                    reply_markup: {
                        inline_keyboard: [[{ text: "❌ Close", callback_data: "close" }]],
                    },
                });
            }
        });
    } catch (error) {
        console.log(error)
    }
}

main().catch(console.error);