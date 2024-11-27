import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { solanaConnection } from "../../volume";
import { Wallet } from "../types/user";
import { NATIVE_MINT } from "@solana/spl-token";
import base58 from "bs58";
import bs58 from "bs58"

export const getBalance = async (publicKey: PublicKey): Promise<number> => {
    const solAmount = (await solanaConnection.getBalance(publicKey)) / LAMPORTS_PER_SOL;
    return solAmount;
};

export const createAccount = async (): Promise<Wallet> => {
    const wallet = Keypair.generate();

    // Convert private key to hex or base58
    const privateKey = bs58.encode(wallet.secretKey); // Hex encoding for private key
    const publicKey = wallet.publicKey.toBase58(); // Base58 for public key

    return {
        privateKey,
        publicKey
    };
};

// Function to create Keypair from private key in hex format
export const keypairFromPrivateKey = (privateKeyHex: string): Keypair => {
    //Convert the hexadecimal private key to a Uint8Array
    const keypair = Keypair.fromSecretKey(bs58.decode(privateKeyHex));
    return keypair;
};

export const validatorTokenAddr = (pupbkey: string) => {
    try {
        new PublicKey(pupbkey)
        return true
    } catch (e) {
        return false
    }
}


export const getTokenInfo = async (tokenAddr: string): Promise<any> => {
    try {
        const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddr}`, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json'
            },
        });
        const data = await res.clone().json()
        if (data.pairs.length == 0) {
            return null
        } else {
            const tokenInfo = data.pairs.filter((pair: any) => pair.dexId === "raydium" && pair.quoteToken.address == NATIVE_MINT.toBase58())[0];
            return tokenInfo;
        }
    } catch (error) {
        console.error(error);
        return null;
    }
};