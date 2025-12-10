import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Web3Provider } from './context/Web3Context';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import CreateSplit from './pages/CreateSplit';
import Transactions from './pages/Transactions';
import PaymentLink from './pages/PaymentLink';
import Navbar from './components/UI/Navbar';
import Footer from './components/UI/Footer';
import './styles/main.css';

function App() {
  return (
    <Web3Provider>
      <Router>
        <div className="app bg-dark-900 min-h-screen">
          <Navbar />
          <main className="pt-20">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/create" element={<CreateSplit />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/payment/:splitId" element={<PaymentLink />} />
            </Routes>
          </main>
          <Footer />
        </div>
      </Router>
    </Web3Provider>
  );
}

export default App;
