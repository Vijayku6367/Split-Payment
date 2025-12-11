import { ethers } from 'ethers';
import Split from '../models/Split.js';
import Payment from '../models/Payment.js';

class ContractService {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(process.env.TEMPO_RPC_URL);
    this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
    
    // Contract ABIs
    this.FACTORY_ABI = [
      "function createSplitter(address[] recipients, uint256[] shares, address token) external returns (address)",
      "function getUserSplitters(address user) external view returns (address[] memory)",
      "event SplitterCreated(address indexed owner, address splitterAddress, address[] recipients, uint256[] shares, address token)"
    ];
    
    this.SPLITTER_ABI = [
      "function distribute(uint256 amount) external",
      "function getConfig() view returns (tuple(address[] recipients, uint256[] shares, address token, address owner, bool active))",
      "function getTotalDistributed() view returns (uint256)",
      "function getBalance() view returns (uint256)",
      "function updateShares(address[] newRecipients, uint256[] newShares) external",
      "function deactivate() external",
      "function activate() external",
      "event PaymentReceived(address indexed payer, uint256 amount, address token)",
      "event Distributed(address indexed recipient, uint256 amount)",
      "event SharesUpdated(address[] recipients, uint256[] shares)"
    ];
    
    this.ERC20_ABI = [
      "function decimals() view returns (uint8)",
      "function symbol() view returns (string)",
      "function name() view returns (string)",
      "function balanceOf(address account) view returns (uint256)",
      "function transfer(address to, uint256 amount) returns (bool)",
      "function approve(address spender, uint256 amount) returns (bool)",
      "function transferFrom(address from, address to, uint256 amount) returns (bool)"
    ];
  // Add this to disable ENS resolution
this.provider = new ethers.JsonRpcProvider(process.env.TEMPO_RPC_URL, undefined, {
  // Remove ENS check
  this.provider = new ethers.JsonRpcProvider(process.env.TEMPO_RPC_URL);
    this.factoryContract = new ethers.Contract(
      process.env.CONTRACT_FACTORY_ADDRESS,
      this.FACTORY_ABI,
      this.wallet
    );
  }
  
  /**
   * Create a new splitter contract
   */
  async createSplitter(recipients, shares, token, owner) {
    try {
      const tx = await this.factoryContract.createSplitter(recipients, shares, token);
      const receipt = await tx.wait();
      
      // Extract contract address from event
      const event = receipt.logs.find(log => 
        log.fragment && log.fragment.name === 'SplitterCreated'
      );
      
      if (!event) {
        throw new Error('Failed to extract contract address from event');
      }
      
      const splitterAddress = event.args[1];
      
      // Get token details
      const tokenDetails = await this.getTokenDetails(token);
      
      // Save to database
      const split = new Split({
        name: `Split ${Date.now()}`,
        contractAddress: splitterAddress,
        owner: owner.toLowerCase(),
        recipients: recipients.map((address, index) => ({
          address: address.toLowerCase(),
          percentage: shares[index] / 100, // Convert basis points to percentage
          share: shares[index]
        })),
        token: token.toLowerCase(),
        tokenSymbol: tokenDetails.symbol,
        tokenDecimals: tokenDetails.decimals,
        createdTx: tx.hash
      });
      
      await split.save();
      
      return {
        success: true,
        splitterAddress,
        txHash: tx.hash,
        splitId: split._id
      };
      
    } catch (error) {
      console.error('Error creating splitter:', error);
      throw new Error(`Failed to create splitter: ${error.message}`);
    }
  }
  
  /**
   * Get splitter contract details
   */
  async getSplitterDetails(contractAddress) {
    try {
      const splitter = new ethers.Contract(
        contractAddress,
        this.SPLITTER_ABI,
        this.provider
      );
      
      const [config, totalDistributed, balance] = await Promise.all([
        splitter.getConfig(),
        splitter.getTotalDistributed(),
        splitter.getBalance()
      ]);
      
      const tokenDetails = await this.getTokenDetails(config.token);
      
      return {
        contractAddress,
        recipients: config.recipients,
        shares: config.shares,
        token: config.token,
        tokenDetails,
        owner: config.owner,
        active: config.active,
        totalDistributed: ethers.formatUnits(totalDistributed, tokenDetails.decimals),
        balance: ethers.formatUnits(balance, tokenDetails.decimals)
      };
      
    } catch (error) {
      console.error('Error getting splitter details:', error);
      throw new Error(`Failed to get splitter details: ${error.message}`);
    }
  }
  
  /**
   * Distribute funds from splitter
   */
  async distributeFunds(contractAddress, amount) {
    try {
      const splitter = new ethers.Contract(
        contractAddress,
        this.SPLITTER_ABI,
        this.wallet
      );
      
      // Get token details
      const config = await splitter.getConfig();
      const tokenDetails = await this.getTokenDetails(config.token);
      
      const amountWei = ethers.parseUnits(amount.toString(), tokenDetails.decimals);
      
      const tx = await splitter.distribute(amountWei);
      const receipt = await tx.wait();
      
      // Parse distribution events
      const distributionEvents = receipt.logs.filter(log => 
        log.fragment && log.fragment.name === 'Distributed'
      ).map(log => ({
        recipient: log.args[0],
        amount: ethers.formatUnits(log.args[1], tokenDetails.decimals),
        amountWei: log.args[1].toString()
      }));
      
      // Update database
      const split = await Split.findOne({ contractAddress: contractAddress.toLowerCase() });
      if (split) {
        split.totalDistributed += parseFloat(amount);
        split.lastDistribution = new Date();
        split.distributions.push({
          txHash: tx.hash,
          amount: parseFloat(amount),
          triggeredBy: 'manual',
          timestamp: new Date()
        });
        await split.save();
      }
      
      return {
        success: true,
        txHash: tx.hash,
        distributions: distributionEvents,
        blockNumber: receipt.blockNumber
      };
      
    } catch (error) {
      console.error('Error distributing funds:', error);
      throw new Error(`Failed to distribute funds: ${error.message}`);
    }
  }
  
  /**
   * Update splitter shares
   */
  async updateShares(contractAddress, newRecipients, newShares, updaterAddress) {
    try {
      // Verify ownership
      const splitter = new ethers.Contract(
        contractAddress,
        this.SPLITTER_ABI,
        this.provider
      );
      
      const config = await splitter.getConfig();
      
      if (config.owner.toLowerCase() !== updaterAddress.toLowerCase()) {
        throw new Error('Only contract owner can update shares');
      }
      
      // Connect with wallet for transaction
      const splitterWithSigner = new ethers.Contract(
        contractAddress,
        this.SPLITTER_ABI,
        this.wallet
      );
      
      const tx = await splitterWithSigner.updateShares(newRecipients, newShares);
      const receipt = await tx.wait();
      
      // Update database
      const split = await Split.findOne({ contractAddress: contractAddress.toLowerCase() });
      if (split) {
        split.recipients = newRecipients.map((address, index) => ({
          address: address.toLowerCase(),
          percentage: newShares[index] / 100,
          share: newShares[index]
        }));
        await split.save();
      }
      
      return {
        success: true,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber
      };
      
    } catch (error) {
      console.error('Error updating shares:', error);
      throw new Error(`Failed to update shares: ${error.message}`);
    }
  }
  
  /**
   * Get token details
   */
  async getTokenDetails(tokenAddress) {
    try {
      const tokenContract = new ethers.Contract(
        tokenAddress,
        this.ERC20_ABI,
        this.provider
      );
      
      const [decimals, symbol, name] = await Promise.all([
        tokenContract.decimals(),
        tokenContract.symbol(),
        tokenContract.name()
      ]);
      
      return {
        address: tokenAddress,
        decimals: Number(decimals),
        symbol,
        name
      };
      
    } catch (error) {
      console.error('Error getting token details:', error);
      // Return default values if contract call fails
      return {
        address: tokenAddress,
        decimals: 18,
        symbol: 'UNKNOWN',
        name: 'Unknown Token'
      };
    }
  }
  
  /**
   * Get user's splitter contracts
   */
  async getUserSplitters(userAddress) {
    try {
      const splitterAddresses = await this.factoryContract.getUserSplitters(userAddress);
      
      const splitters = await Promise.all(
        splitterAddresses.map(async (address) => {
          try {
            const details = await this.getSplitterDetails(address);
            return {
              address,
              ...details
            };
          } catch (error) {
            return {
              address,
              error: error.message
            };
          }
        })
      );
      
      return splitters;
      
    } catch (error) {
      console.error('Error getting user splitters:', error);
      throw new Error(`Failed to get user splitters: ${error.message}`);
    }
  }
  
  /**
   * Check contract balance
   */
  async checkBalance(contractAddress) {
    try {
      const splitter = new ethers.Contract(
        contractAddress,
        this.SPLITTER_ABI,
        this.provider
      );
      
      const balance = await splitter.getBalance();
      const config = await splitter.getConfig();
      const tokenDetails = await this.getTokenDetails(config.token);
      
      return {
        balance: ethers.formatUnits(balance, tokenDetails.decimals),
        balanceWei: balance.toString(),
        token: config.token,
        tokenDetails
      };
      
    } catch (error) {
      console.error('Error checking balance:', error);
      throw new Error(`Failed to check balance: ${error.message}`);
    }
  }
  
  /**
   * Process payment and record in database
   */
  async processPayment(splitAddress, amount, token, payerAddress, txHash) {
    try {
      // Verify transaction
      const receipt = await this.provider.getTransactionReceipt(txHash);
      
      if (!receipt) {
        throw new Error('Transaction not found');
      }
      
      if (receipt.status !== 1) {
        throw new Error('Transaction failed');
      }
      
      // Get splitter details
      const splitter = new ethers.Contract(
        splitAddress,
        this.SPLITTER_ABI,
        this.provider
      );
      
      const config = await splitter.getConfig();
      const tokenDetails = await this.getTokenDetails(token);
      
      // Parse events from receipt
      const paymentEvent = receipt.logs.find(log => 
        log.fragment && log.fragment.name === 'PaymentReceived'
      );
      
      const distributionEvents = receipt.logs.filter(log => 
        log.fragment && log.fragment.name === 'Distributed'
      ).map(log => ({
        recipient: log.args[0],
        amount: ethers.formatUnits(log.args[1], tokenDetails.decimals),
        amountWei: log.args[1].toString()
      }));
      
      // Find split in database
      const split = await Split.findOne({ contractAddress: splitAddress.toLowerCase() });
      
      if (!split) {
        throw new Error('Split contract not found in database');
      }
      
      // Create payment record
      const payment = new Payment({
        splitId: split._id,
        contractAddress: splitAddress.toLowerCase(),
        payerAddress: payerAddress.toLowerCase(),
        amount: parseFloat(amount),
        amountWei: ethers.parseUnits(amount.toString(), tokenDetails.decimals).toString(),
        token: token.toLowerCase(),
        tokenSymbol: tokenDetails.symbol,
        tokenDecimals: tokenDetails.decimals,
        txHash,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        gasUsed: receipt.gasUsed?.toString(),
        gasPrice: receipt.gasPrice?.toString(),
        distributions: distributionEvents,
        status: 'completed',
        confirmedAt: new Date()
      });
      
      await payment.save();
      
      // Update split statistics
      split.totalPayments += 1;
      split.totalAmount += parseFloat(amount);
      split.lastPayment = new Date();
      await split.save();
      
      return {
        success: true,
        paymentId: payment._id,
        distributions: distributionEvents
      };
      
    } catch (error) {
      console.error('Error processing payment:', error);
      
      // Save failed payment attempt
      const failedPayment = new Payment({
        contractAddress: splitAddress.toLowerCase(),
        payerAddress: payerAddress.toLowerCase(),
        amount: parseFloat(amount),
        token: token.toLowerCase(),
        txHash,
        status: 'failed',
        error: error.message,
        timestamp: new Date()
      });
      
      await failedPayment.save();
      
      throw new Error(`Failed to process payment: ${error.message}`);
    }
  }
  
  /**
   * Get transaction status
   */
  async getTransactionStatus(txHash) {
    try {
      const receipt = await this.provider.getTransactionReceipt(txHash);
      
      if (!receipt) {
        return { status: 'pending', found: false };
      }
      
      return {
        status: receipt.status === 1 ? 'completed' : 'failed',
        found: true,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed?.toString(),
        confirmations: await this.getConfirmations(receipt.blockNumber)
      };
      
    } catch (error) {
      console.error('Error getting transaction status:', error);
      return { status: 'error', error: error.message };
    }
  }
  
  /**
   * Get block confirmations
   */
  async getConfirmations(blockNumber) {
    try {
      const currentBlock = await this.provider.getBlockNumber();
      return currentBlock - blockNumber;
    } catch (error) {
      return 0;
    }
  }
  
  /**
   * Verify signature
   */
  async verifySignature(message, signature, expectedAddress) {
    try {
      const recoveredAddress = ethers.verifyMessage(message, signature);
      return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
    } catch (error) {
      console.error('Error verifying signature:', error);
      return false;
    }
  }
}

export default new ContractService();
