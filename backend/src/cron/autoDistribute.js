import cron from 'node-cron';
import { ethers } from 'ethers';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import SplitContract from '../models/SplitContract.js';

dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI);

// Tempo RPC URL
const RPC_URL = process.env.TEMPO_RPC_URL || 'https://rpc.tempo.network';
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// Splitter ABI
const SPLITTER_ABI = [
  "function getBalance() view returns (uint256)",
  "function distribute(uint256 amount) external",
  "function getConfig() view returns (tuple(address[] recipients, uint256[] shares, address token, address owner, bool active))"
];

// Cron job to auto-distribute funds every hour
cron.schedule('0 * * * *', async () => {
  console.log('Running auto-distribution job...');
  
  try {
    // Find all split contracts with pending distributions
    const contracts = await SplitContract.find({
      autoDistribute: true,
      lastDistribution: { $lt: new Date(Date.now() - 3600000) } // More than 1 hour ago
    });

    for (const contract of contracts) {
      try {
        const splitter = new ethers.Contract(
          contract.address,
          SPLITTER_ABI,
          wallet
        );

        // Check balance
        const balance = await splitter.getBalance();
        const config = await splitter.getConfig();

        if (balance > 0 && config.active) {
          // Minimum threshold to avoid gas costs for tiny amounts
          const MIN_THRESHOLD = ethers.parseUnits('10', 6); // 10 USDC
          
          if (balance >= MIN_THRESHOLD) {
            // Execute distribution
            const tx = await splitter.distribute(balance);
            await tx.wait();

            console.log(`Distributed ${ethers.formatUnits(balance, 6)} from ${contract.address}`);
            
            // Update last distribution time
            contract.lastDistribution = new Date();
            await contract.save();
          }
        }
      } catch (error) {
        console.error(`Error distributing for ${contract.address}:`, error.message);
      }
    }

    console.log('Auto-distribution job completed');
  } catch (error) {
    console.error('Cron job error:', error);
  }
});

console.log('Auto-distribution cron job scheduled');
