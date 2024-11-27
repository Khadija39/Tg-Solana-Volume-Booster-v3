import TelegramBot from "node-telegram-bot-api";
import { User, Wallet } from "../types/user";
import { createAccount, getBalance, getTokenInfo, validatorTokenAddr } from "../utils/utils";
import { PublicKey } from "@solana/web3.js";
import { errorLOG } from "../utils/logs";

export async function InputTokenAddr(
    usersCollection: any,
    user: User,
    bot: TelegramBot,
    chatId: number
) {

}

export async function botRunningCallback(
    usersCollection: any,
    user: User,
    bot: TelegramBot,
    chatId: number
) {

}