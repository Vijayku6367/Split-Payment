import { ethers } from 'ethers';
import * as fs from 'fs';

// Load contract ABIs
const SplitFactoryArtifact = JSON.parse(fs.readFileSync('./artifacts/contracts/SplitFactory.sol/SplitFactory.json', 'utf8'));
const SplitterArtifact = JSON.parse(fs.readFileSync('./artifacts/contracts/Splitter.sol/Splitter.json', 'utf8'));
const TreasuryArtifact = JSON.parse(fs.readFileSync('./artifacts/contracts/Treasury.sol/Treasury.json', 'utf8'));

async function deployContracts() {
  console.log('🚀 Starting contract deployment...');
  
  // Connect to Tempo network
  const provider = new ethers.JsonRpcProvider('https://testnet.rpc.tempo.network');
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  
  console.log(`Deployer: ${wallet.address}`);
  console.log(`Balance: ${ethers.formatEther(await provider.getBalance(wallet.address))} TEMPO`);
  
  try {
    // 1. Deploy Treasury
    console.log('\n📦 Deploying Treasury...');
    const TreasuryFactory = new ethers.ContractFactory(
      TreasuryArtifact.abi,
      TreasuryArtifact.bytecode,
      wallet
    );
    
    const treasury = await TreasuryFactory.deploy();
    await treasury.waitForDeployment();
    const treasuryAddress = await treasury.getAddress();
    console.log(`✅ Treasury deployed at: ${treasuryAddress}`);
    
    // 2. Deploy SplitFactory
    console.log('\n🏭 Deploying SplitFactory...');
    const SplitFactoryFactory = new ethers.ContractFactory(
      SplitFactoryArtifact.abi,
      SplitFactoryArtifact.bytecode,
      wallet
    );
    
    const splitFactory = await SplitFactoryFactory.deploy();
    await splitFactory.waitForDeployment();
    const factoryAddress = await splitFactory.getAddress();
    console.log(`✅ SplitFactory deployed at: ${factoryAddress}`);
    
    // Save addresses to config file
    const addresses = {
      network: 'tempo-testnet',
      treasury: treasuryAddress,
      splitFactory: factoryAddress,
      deploymentTimestamp: new Date().toISOString(),
      deployer: wallet.address
    };
    
    fs.writeFileSync(
      './config/deployed-addresses.json',
      JSON.stringify(addresses, null, 2)
    );
    
    console.log('\n🎉 All contracts deployed successfully!');
    console.log('\n📝 Contract addresses saved to config/deployed-addresses.json');
    
    return addresses;
    
  } catch (error) {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  }
}

// Run deployment
deployContracts();
