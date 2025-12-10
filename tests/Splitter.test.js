import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('Splitter Contract', function () {
  let Splitter;
  let splitter;
  let owner;
  let recipient1;
  let recipient2;
  let token;
  let MockERC20;

  beforeEach(async function () {
    [owner, recipient1, recipient2] = await ethers.getSigners();

    // Deploy mock ERC20 token
    const MockERC20Factory = await ethers.getContractFactory('MockERC20');
    token = await MockERC20Factory.deploy('Test Token', 'TEST', 18);
    await token.waitForDeployment();

    // Mint tokens to owner
    await token.mint(owner.address, ethers.parseUnits('1000', 18));

    // Deploy Splitter
    const recipients = [recipient1.address, recipient2.address];
    const shares = [7000, 3000]; // 70% and 30%

    const SplitterFactory = await ethers.getContractFactory('Splitter');
    splitter = await SplitterFactory.deploy(
      recipients,
      shares,
      await token.getAddress(),
      owner.address
    );
    await splitter.waitForDeployment();
  });

  describe('Deployment', function () {
    it('Should set the right owner', async function () {
      expect(await splitter.owner()).to.equal(owner.address);
    });

    it('Should set the right recipients and shares', async function () {
      const config = await splitter.getConfig();
      expect(config.recipients[0]).to.equal(recipient1.address);
      expect(config.recipients[1]).to.equal(recipient2.address);
      expect(config.shares[0]).to.equal(7000);
      expect(config.shares[1]).to.equal(3000);
    });
  });

  describe('Distribution', function () {
    it('Should distribute tokens correctly', async function () {
      const amount = ethers.parseUnits('100', 18);
      
      // Approve splitter to spend tokens
      await token.approve(await splitter.getAddress(), amount);
      
      // Distribute
      await splitter.distribute(amount);
      
      // Check balances
      const recipient1Balance = await token.balanceOf(recipient1.address);
      const recipient2Balance = await token.balanceOf(recipient2.address);
      
      expect(recipient1Balance).to.equal(ethers.parseUnits('70', 18)); // 70%
      expect(recipient2Balance).to.equal(ethers.parseUnits('30', 18)); // 30%
    });

    it('Should emit Distribution events', async function () {
      const amount = ethers.parseUnits('100', 18);
      await token.approve(await splitter.getAddress(), amount);
      
      const tx = await splitter.distribute(amount);
      const receipt = await tx.wait();
      
      const events = receipt.logs.filter(log => 
        log.fragment && log.fragment.name === 'Distributed'
      );
      
      expect(events.length).to.equal(2);
    });
  });

  describe('Access Control', function () {
    it('Should allow owner to update shares', async function () {
      const newRecipients = [recipient1.address];
      const newShares = [10000]; // 100%
      
      await splitter.updateShares(newRecipients, newShares);
      
      const config = await splitter.getConfig();
      expect(config.recipients.length).to.equal(1);
      expect(config.shares[0]).to.equal(10000);
    });

    it('Should not allow non-owner to update shares', async function () {
      const newRecipients = [recipient1.address];
      const newShares = [10000];
      
      await expect(
        splitter.connect(recipient1).updateShares(newRecipients, newShares)
      ).to.be.revertedWith('Only owner');
    });
  });
});
