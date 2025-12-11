// scripts/deploy.js  (CommonJS, Hardhat v2 friendly)
const fs = require('fs');
const hre = require('hardhat');

async function main() {
  console.log('🚀 Starting contract deployment...');

  const [deployer] = await hre.ethers.getSigners();
  console.log('Deployer:', deployer.address);
  const balance = await deployer.getBalance();
  console.log('Balance:', hre.ethers.utils.formatEther(balance), 'ETH');

  // Deploy Treasury
  // Deploy Treasury
console.log("🚀 Deploying Treasury...");
const TreasuryFactory = await hre.ethers.getContractFactory("Treasury");
// Remove the entire object with gas settings
const treasury = await TreasuryFactory.deploy();
await treasury.deployed();

console.log("🚀 Deploying SplitFactory...");
const SplitFactoryFactory = await hre.ethers.getContractFactory("SplitFactory");
// Remove the entire object with gas settings
const splitFactory = await SplitFactoryFactory.deploy();
await splitFactory.deployed();
  // const SplitterFactory = await hre.ethers.getContractFactory('Splitter');
  // const splitter = await SplitterFactory.deploy([deployer.address], [10000], hre.ethers.constants.AddressZero);
  // await splitter.deployed();

  // Save addresses to config file
  const addresses = {
    network: hre.network.name,
    treasury: treasury.address,
    splitFactory: splitFactory.address,
    // splitter: splitter ? splitter.address : null,
    deploymentTimestamp: new Date().toISOString(),
    deployer: deployer.address,
  };

  if (!fs.existsSync('./config')) {
    fs.mkdirSync('./config', { recursive: true });
  }

  fs.writeFileSync('./config/deployed-addresses.json', JSON.stringify(addresses, null, 2));
  console.log('\n📁 Contract addresses saved to ./config/deployed-addresses.json');

  return addresses;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Deployment failed:', err);
    process.exit(1);
  });
