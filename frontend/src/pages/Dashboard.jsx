import React, { useState, useEffect } from 'react';
import { useWeb3 } from '../context/Web3Context';
import { ethers } from 'ethers';
import SplitChart from '../components/Dashboard/SplitChart';
import RecentTransactions from '../components/Dashboard/RecentTransactions';
import StatsCards from '../components/Dashboard/StatsCards';
import RecipientList from '../components/Dashboard/RecipientList';
import SplitFactoryABI from '../../abis/SplitFactory.json';
import SplitterABI from '../../abis/Splitter.json';
import { CONTRACT_ADDRESSES } from '../utils/constants';

const Dashboard = () => {
  const { account, provider } = useWeb3();
  const [splits, setSplits] = useState([]);
  const [totalDistributed, setTotalDistributed] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (account && provider) {
      loadSplits();
    }
  }, [account, provider]);

  const loadSplits = async () => {
    try {
      const signer = await provider.getSigner();
      const factory = new ethers.Contract(
        CONTRACT_ADDRESSES.Factory,
        SplitFactoryABI,
        signer
      );

      const splitterAddresses = await factory.getUserSplitters(account);
      
      const splitData = await Promise.all(
        splitterAddresses.map(async (address) => {
          const splitter = new ethers.Contract(
            address,
            SplitterABI,
            signer
          );
          
          const config = await splitter.getConfig();
          const totalDistributed = await splitter.getTotalDistributed();
          const balance = await splitter.getBalance();
          
          return {
            address,
            recipients: config.recipients,
            shares: config.shares,
            token: config.token,
            owner: config.owner,
            active: config.active,
            totalDistributed: ethers.formatUnits(totalDistributed, 6),
            balance: ethers.formatUnits(balance, 6)
          };
        })
      );
      
      setSplits(splitData);
      calculateTotalDistributed(splitData);
      setLoading(false);
    } catch (error) {
      console.error('Error loading splits:', error);
      setLoading(false);
    }
  };

  const calculateTotalDistributed = (splitData) => {
    const total = splitData.reduce((sum, split) => {
      return sum + parseFloat(split.totalDistributed);
    }, 0);
    setTotalDistributed(total);
  };

  const createNewSplit = async (recipients, shares, token) => {
    try {
      const signer = await provider.getSigner();
      const factory = new ethers.Contract(
        CONTRACT_ADDRESSES.Factory,
        SplitFactoryABI,
        signer
      );

      const tx = await factory.createSplitter(recipients, shares, token);
      await tx.wait();
      
      loadSplits(); // Refresh the list
      return { success: true, txHash: tx.hash };
    } catch (error) {
      console.error('Error creating split:', error);
      return { success: false, error: error.message };
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-gold-500"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">Dashboard</h1>
        <p className="text-gray-400">
          Manage your split payments and monitor distributions
        </p>
      </div>

      <StatsCards 
        totalSplits={splits.length}
        totalDistributed={totalDistributed}
        activeSplits={splits.filter(s => s.active).length}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
        <div className="lg:col-span-2">
          <div className="glass-card p-6">
            <h2 className="text-2xl font-semibold text-white mb-6">
              Your Split Contracts
            </h2>
            {splits.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-gray-400 mb-4">
                  <i className="fas fa-code-branch text-4xl"></i>
                </div>
                <h3 className="text-xl font-medium text-white mb-2">
                  No Split Contracts Found
                </h3>
                <p className="text-gray-400 mb-6">
                  Create your first split contract to start distributing payments
                </p>
                <a 
                  href="/create" 
                  className="btn-primary inline-flex items-center"
                >
                  <i className="fas fa-plus mr-2"></i>
                  Create Split Contract
                </a>
              </div>
            ) : (
              <div className="space-y-4">
                {splits.map((split, index) => (
                  <div key={index} className="split-card p-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <h3 className="font-medium text-white">
                          Split #{index + 1}
                        </h3>
                        <p className="text-sm text-gray-400 truncate">
                          {split.address}
                        </p>
                      </div>
                      <div className="flex items-center space-x-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                          split.active 
                            ? 'bg-green-500/20 text-green-400' 
                            : 'bg-red-500/20 text-red-400'
                        }`}>
                          {split.active ? 'Active' : 'Inactive'}
                        </span>
                        <span className="text-gold-500 font-semibold">
                          ${split.totalDistributed}
                        </span>
                      </div>
                    </div>
                    <div className="mt-4">
                      <div className="flex justify-between text-sm text-gray-400 mb-2">
                        <span>Recipients: {split.recipients.length}</span>
                        <span>Balance: ${split.balance}</span>
                      </div>
                      <div className="flex space-x-2">
                        <a 
                          href={`/payment/${split.address}`}
                          className="btn-secondary text-sm px-3 py-1"
                        >
                          Payment Link
                        </a>
                        <button className="btn-outline text-sm px-3 py-1">
                          View Details
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="glass-card p-6 mt-8">
            <RecentTransactions splits={splits} />
          </div>
        </div>

        <div className="space-y-8">
          <div className="glass-card p-6">
            <h2 className="text-2xl font-semibold text-white mb-6">
              Split Distribution
            </h2>
            <SplitChart splits={splits} />
          </div>

          <div className="glass-card p-6">
            <h2 className="text-2xl font-semibold text-white mb-6">
              Quick Actions
            </h2>
            <div className="space-y-4">
              <a 
                href="/create" 
                className="btn-primary w-full justify-center"
              >
                <i className="fas fa-plus mr-2"></i>
                Create New Split
              </a>
              <button className="btn-secondary w-full justify-center">
                <i className="fas fa-qrcode mr-2"></i>
                Generate Payment Link
              </button>
              <button className="btn-outline w-full justify-center">
                <i className="fas fa-file-export mr-2"></i>
                Export Transactions
              </button>
            </div>
          </div>

          {splits.length > 0 && (
            <div className="glass-card p-6">
              <RecipientList splits={splits} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
