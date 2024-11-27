import {
  getAssociatedTokenAddress,
} from '@solana/spl-token'
import {
  Keypair,
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  VersionedTransaction,
  TransactionInstruction,
  TransactionMessage,
  ComputeBudgetProgram,
  Transaction,
  sendAndConfirmTransaction,
  Commitment
} from '@solana/web3.js'
import {
  BUY_INTERVAL_MAX,
  BUY_INTERVAL_MIN,
  SELL_INTERVAL_MAX,
  SELL_INTERVAL_MIN,
  BUY_LOWER_PERCENT,
  BUY_UPPER_PERCENT,
  DISTRIBUTE_WALLET_NUM,
  RPC_ENDPOINT,
  RPC_WEBSOCKET_ENDPOINT,
  JITO_MODE,
} from './constants'
import { Data, readJson, saveDataToFile, sleep } from './utils'
import base58 from 'bs58'
import { getBuyTxWithJupiter, getSellTxWithJupiter } from './utils/swapOnlyAmm'
import { execute } from './executor/legacy'
import { executeJitoTx } from './executor/jito'
import { User } from './telegramUI/types/user'
import { keypairFromPrivateKey } from './telegramUI/utils/utils'
import TelegramBot from 'node-telegram-bot-api'

export const solanaConnection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT, commitment: "confirmed"
})

const distritbutionNum = DISTRIBUTE_WALLET_NUM > 20 ? 20 : DISTRIBUTE_WALLET_NUM
const jitoCommitment: Commitment = "confirmed"

export const start = async (user: User, usersCollection: any, chatId: number, bot: TelegramBot) => {

  // const mainKp = Keypair.fromSecretKey(base58.decode(user.wallets[0].privateKey))
  console.log("1=================")
  const mainKp = await keypairFromPrivateKey(user.wallets[0].privateKey)
  console.log("🚀 ~ start ~ mainKp:", mainKp)
  const baseMint = new PublicKey(user.tokenAddr)
  const solBalance = await solanaConnection.getBalance(mainKp.publicKey)
  console.log(`Volume bot is running`)
  console.log(`Wallet address: ${mainKp.publicKey.toBase58()}`)
  console.log(`Pool token mint: ${baseMint.toBase58()}`)
  console.log(`Wallet SOL balance: ${(solBalance / LAMPORTS_PER_SOL).toFixed(3)}SOL`)
  console.log(`Buying wait time max: ${BUY_INTERVAL_MAX}s`)
  console.log(`Buying wait time min: ${BUY_INTERVAL_MIN}s`)
  console.log(`Selling wait time max: ${SELL_INTERVAL_MAX}s`)
  console.log(`Selling wait time min: ${SELL_INTERVAL_MIN}s`)
  console.log(`Buy upper limit percent: ${BUY_UPPER_PERCENT}%`)
  console.log(`Buy lower limit percent: ${BUY_LOWER_PERCENT}%`)
  console.log(`Distribute SOL to ${distritbutionNum} wallets`)

  let data: {
    kp: Keypair;
    buyAmount: number;
  }[] | null = null

  if (solBalance < (BUY_LOWER_PERCENT + 0.002) * distritbutionNum) {
    console.log("Sol balance is not enough for distribution")
    bot.sendMessage(chatId, `⚠️ Sol balance is not enough for distribution.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "❌ Close", callback_data: "close" }, {
            text: "🔙 Back",
            callback_data: "settings",
          }],
        ],
      },
    });
  }

  data = await distributeSol(solanaConnection, mainKp, distritbutionNum, chatId, usersCollection)
  if (data == null || data.length == 0) {
    console.log("Distribution failed")
    bot.sendMessage(chatId, `⚠️ Distribution failed.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "❌ Close", callback_data: "close" }, {
            text: "🔙 Back",
            callback_data: "settings",
          }],
        ],
      },
    });
    return
  }

  data.map(async ({ kp }, i) => {
    await sleep(i * 10000)
    let srcKp = kp
    while (true) {
      let user = (await usersCollection.findOne({ id: chatId })) as User | null;
      console.log("volume bot status stop", user?.status)
      if (!user?.status) {
        await usersCollection.updateOne(
          { id: chatId }, // Find the user by id
          { $set: { status: false } } // Update the slippage field
        );
        bot.sendMessage(chatId, `Bot is Stopped.`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: "❌ Close", callback_data: "close" }, {
                text: "🔙 Back",
                callback_data: "settings",
              }],
            ],
          },
        });
        return
      }
      console.log("SrcKp", srcKp.publicKey)
      const solBalance = await solanaConnection.getBalance(srcKp.publicKey)

      console.log("solbalabnce==========", solBalance)
      let buyAmountInPercent = Number((Math.random() * (BUY_UPPER_PERCENT - BUY_LOWER_PERCENT) + BUY_LOWER_PERCENT).toFixed(3))

      if (solBalance < 5 * 10 ** 6) {
        console.log("Sol balance is not enough in one of wallets")
        return
      }

      const txList: Array<VersionedTransaction> = [];
      let buyAmountFirst = Math.floor((solBalance - 5 * 10 ** 6) / 100 * buyAmountInPercent)
      let buyAmountSecond = Math.floor(solBalance - buyAmountFirst - 5 * 10 ** 6)

      // try buying until success
      let sellAmt = 0;
      const firstBuyTx = await buyForJito(srcKp, baseMint, buyAmountFirst)
      if (firstBuyTx) {
        txList.push(firstBuyTx.Ok.tx);
        sellAmt += firstBuyTx.Ok.amount;
      }

      const secondBuyTx = await buyForJito(srcKp, baseMint, buyAmountSecond)
      if (secondBuyTx) {
        txList.push(secondBuyTx.Ok.tx)
        sellAmt += secondBuyTx.Ok.amount;
      }

      const sellTx = await sellForJito(baseMint, srcKp, Math.floor(sellAmt * 0.99))
      if (sellTx) {
        txList.push(sellTx)
      }

      let txSig
      txSig = await executeJitoTx(txList, mainKp, jitoCommitment)
      if (txSig) {
        const amount = sellAmt * 2
        const result = await usersCollection.updateOne(
          { id: chatId }, // Find the user by id
          { $set: { boostedVolume: amount } } // Update the slippage field
        );
        const tokenBuyTx = txSig ? `https://solscan.io/tx/${txSig}` : ''
        console.log("Success in buy transaction: ", tokenBuyTx)
      } else {
        return null
      }

      let j = 0
      while (true) {
        if (j > 10) {
          console.log("Error in sell transaction")
          return
        }
        const result = await sell(baseMint, srcKp, mainKp)
        if (result) {
          break
        } else {
          j++
          await sleep(2000)
        }
      }

      // const balance = await solanaConnection.getBalance(srcKp.publicKey)
      // if (balance < 5 * 10 ** 6) {
      //   console.log("Sub wallet balance is not enough to continue volume swap")
      //   return
      // }
      // let k = 0
      // while (true) {
      //   try {
      //     if (k > 5) {
      //       console.log("Failed to transfer SOL to new wallet in one of sub wallet")
      //       return
      //     }
      //     const destinationKp = Keypair.generate()

      //     const tx = new Transaction().add(
      //       ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
      //       ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
      //       SystemProgram.transfer({
      //         fromPubkey: srcKp.publicKey,
      //         toPubkey: destinationKp.publicKey,
      //         lamports: balance - 17_000
      //       })
      //     )

      //     tx.feePayer = srcKp.publicKey
      //     tx.recentBlockhash = (await solanaConnection.getLatestBlockhash("finalized")).blockhash

      //     // console.log(await solanaConnection.simulateTransaction(tx))
      //     saveDataToFile([{
      //       privateKey: base58.encode(destinationKp.secretKey),
      //       pubkey: destinationKp.publicKey.toBase58(),
      //     }])
      //     const sig = await sendAndConfirmTransaction(solanaConnection, tx, [srcKp], { skipPreflight: true, commitment: "finalized" })
      //     srcKp = destinationKp
      //     // console.log(await solanaConnection.getBalance(destinationKp.publicKey) / 10 ** 9, "SOL")
      //     console.log(`Transferred SOL to new wallet after buy and sell, https://solscan.io/tx/${sig}`)
      //     await sleep(5000)
      //     break
      //   } catch (error) {
      //     k++
      //   }
      // }
    }
  })

}

const distributeSol = async (connection: Connection, mainKp: Keypair, distritbutionNum: number, chatId: number, usersCollection: any) => {
  const data: Data[] = []
  const wallets = []
  try {
    const sendSolTx: TransactionInstruction[] = []
    sendSolTx.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 250_000 })
    )
    const mainSolBal = await connection.getBalance(mainKp.publicKey)
    if (mainSolBal <= 4 * 10 ** 6) {
      console.log("Main wallet balance is not enough")
      return []
    }
    let solAmount = Math.floor(mainSolBal / distritbutionNum - 5 * 10 ** 6)

    for (let i = 0; i < distritbutionNum; i++) {

      const wallet = Keypair.generate()
      wallets.push({ kp: wallet, buyAmount: solAmount })

      sendSolTx.push(
        SystemProgram.transfer({
          fromPubkey: mainKp.publicKey,
          toPubkey: wallet.publicKey,
          lamports: solAmount
        })
      )
    }

    let index = 0
    while (true) {
      try {
        if (index > 5) {
          console.log("Error in distribution")
          return null
        }
        const siTx = new Transaction().add(...sendSolTx)
        const latestBlockhash = await solanaConnection.getLatestBlockhash("finalized")
        siTx.feePayer = mainKp.publicKey
        siTx.recentBlockhash = latestBlockhash.blockhash
        const messageV0 = new TransactionMessage({
          payerKey: mainKp.publicKey,
          recentBlockhash: latestBlockhash.blockhash,
          instructions: sendSolTx,
        }).compileToV0Message()
        const transaction = new VersionedTransaction(messageV0)
        transaction.sign([mainKp])
        let txSig
        if (JITO_MODE && false) {
          txSig = await executeJitoTx([transaction], mainKp, jitoCommitment)
        } else {
          txSig = await execute(transaction, latestBlockhash, 1)
        }
        if (txSig) {
          const distibuteTx = txSig ? `https://solscan.io/tx/${txSig}` : ''
          console.log("SOL distributed ", distibuteTx)
          break
        }
        index++
      } catch (error) {
        index++
      }
    }

    wallets.map(async (wallet) => {
      data.push({
        privateKey: base58.encode(wallet.kp.secretKey),
        pubkey: wallet.kp.publicKey.toBase58(),
      })

      await usersCollection.updateOne(
        { id: chatId },
        {
          $push: {
            subWallets: {
              privateKey: base58.encode(wallet.kp.secretKey), // Hex-encoded private key
              publicKey: wallet.kp.publicKey.toBase58(),   // Base58-encoded public key
            },
          },
        },
        // { new: true }
      );
    })

    try {
      saveDataToFile(data)
    } catch (error) {

    }
    console.log("Success in distribution")
    return wallets
  } catch (error) {
    console.log(`Failed to transfer SOL`)
    return null
  }
}

const buyForJito = async (newWallet: Keypair, baseMint: PublicKey, buyAmount: number) => {
  let solBalance: number = 0
  try {
    solBalance = await solanaConnection.getBalance(newWallet.publicKey)
  } catch (error) {
    console.log("Error getting balance of wallet")
    return null
  }
  if (solBalance == 0) {
    return null
  }
  try {
    let buyTx = await getBuyTxWithJupiter(newWallet, baseMint, buyAmount)
    if (buyTx == null) {
      console.log(`Error getting buy transaction`)
      return null
    }
    return buyTx;
  } catch (error) {
    return null
  }
}

const sellForJito = async (baseMint: PublicKey, wallet: Keypair, tokenBalance: number) => {
  try {
    const data: Data[] = readJson()
    if (data.length == 0) {
      await sleep(1000)
      return null
    }

    try {
      let sellTx = await getSellTxWithJupiter(wallet, baseMint, tokenBalance.toString())

      if (sellTx == null) {
        console.log(`Error getting sell transaction`)
        return null
      }

      return sellTx;
    } catch (error) {
      return null
    }
  } catch (error) {
    return null
  }
}

// const buy = async (newWallet: Keypair, baseMint: PublicKey, buyAmount: number) => {
//   let solBalance: number = 0
//   try {
//     solBalance = await solanaConnection.getBalance(newWallet.publicKey)
//   } catch (error) {
//     console.log("Error getting balance of wallet")
//     return null
//   }
//   if (solBalance == 0) {
//     return null
//   }
//   try {
//     let buyTx = await getBuyTxWithJupiter(newWallet, baseMint, buyAmount)
//     if (buyTx == null) {
//       console.log(`Error getting buy transaction`)
//       return null
//     }
//     // console.log(await solanaConnection.simulateTransaction(buyTx))
//     let txSig
//     if (JITO_MODE) {
//       txSig = await executeJitoTx([buyTx.Ok.tx], mainKp, jitoCommitment)
//     } else {
//       const latestBlockhash = await solanaConnection.getLatestBlockhash("finalized")
//       txSig = await execute(buyTx.Ok.tx, latestBlockhash, 1)
//     }
//     if (txSig) {
//       const tokenBuyTx = txSig ? `https://solscan.io/tx/${txSig}` : ''
//       console.log("Success in buy transaction: ", tokenBuyTx)
//       return tokenBuyTx
//     } else {
//       return null
//     }
//   } catch (error) {
//     return null
//   }
// }

const sell = async (baseMint: PublicKey, wallet: Keypair, mainKp: Keypair) => {
  try {
    const data: Data[] = readJson()
    if (data.length == 0) {
      await sleep(1000)
      return null
    }

    const tokenAta = await getAssociatedTokenAddress(baseMint, wallet.publicKey)
    const tokenBalInfo = await solanaConnection.getTokenAccountBalance(tokenAta)
    if (!tokenBalInfo) {
      console.log("Balance incorrect")
      return null
    }
    const tokenBalance = tokenBalInfo.value.amount

    try {
      let sellTx = await getSellTxWithJupiter(wallet, baseMint, tokenBalance)

      if (sellTx == null) {
        console.log(`Error getting buy transaction`)
        return null
      }
      // console.log(await solanaConnection.simulateTransaction(sellTx))
      let txSig
      if (JITO_MODE) {
        txSig = await executeJitoTx([sellTx], mainKp, jitoCommitment)
      } else {
        const latestBlockhash = await solanaConnection.getLatestBlockhash("finalized")
        txSig = await execute(sellTx, latestBlockhash, 1)
      }
      if (txSig) {
        const tokenSellTx = txSig ? `https://solscan.io/tx/${txSig}` : ''
        console.log("Success in sell transaction: ", tokenSellTx)
        return tokenSellTx
      } else {
        return null
      }
    } catch (error) {
      return null
    }
  } catch (error) {
    return null
  }
}

