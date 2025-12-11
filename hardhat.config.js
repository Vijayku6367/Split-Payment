require('dotenv').config();
require('@nomiclabs/hardhat-ethers');

/** @type import('hardhat/config').HardhatUserConfig */

const PRIVATE_KEY = (process.env.PRIVATE_KEY || "").trim();

module.exports = {
  solidity: "0.8.19",

  networks: {
    hardhat: {},

    "tempo-testnet": {
      url: process.env.TEMPO_RPC_URL || "https://rpc.testnet.tempo.xyz",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],

      // --- IMPORTANT FOR TEMPO ---
      gasPrice: undefined,                 // ❌ disable legacy gasPrice
      maxFeePerGas: 1_200_000_000,         // ✔ 1.2 gwei
      maxPriorityFeePerGas: 0,             // ✔ Tempo priority fee = 0
      gas: "auto"
    },

    "tempo-mainnet": {
      url: process.env.TEMPO_RPC_URL || "https://rpc.tempo.xyz",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],

      // same Tempo rules
      gasPrice: undefined,
      maxFeePerGas: 1_200_000_000,
      maxPriorityFeePerGas: 0,
      gas: "auto"
    }
  }
};
