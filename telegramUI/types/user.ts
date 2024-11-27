export interface User {
    id: number;
    username: string;
    wallets: Wallet[];
    subWallets: Wallet[];
    tokenAddr: string;
    boostedVolume: number;
    status: boolean;
}

export interface Wallet {
    privateKey: string;
    publicKey: string;
}