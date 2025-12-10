require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.19",
  networks: {
    "tempo-testnet": {
      url: "https://testnet.rpc.tempo.network",
      accounts: [process.env.PRIVATE_KEY]
    },
    "tempo-mainnet": {
      url: "https://rpc.tempo.network",
      accounts: [process.env.PRIVATE_KEY]
    }
  }
};
