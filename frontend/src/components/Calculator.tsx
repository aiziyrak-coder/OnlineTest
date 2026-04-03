import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calculator as CalcIcon, X } from 'lucide-react';

export function Calculator() {
  const [isOpen, setIsOpen] = useState(false);
  const [display, setDisplay] = useState('0');
  const [equation, setEquation] = useState('');

  const handleNumber = (num: string) => {
    if (display === '0') setDisplay(num);
    else setDisplay(display + num);
  };

  const handleOperator = (op: string) => {
    setEquation(display + ' ' + op + ' ');
    setDisplay('0');
  };

  const calculate = () => {
    try {
      const expr = equation + display;
      // Safe math evaluation respecting precedence
      // Only allow numbers and basic operators
      if (!/^[\d\.\+\-\*\/\s]+$/.test(expr)) throw new Error('Invalid input');
      
      // eslint-disable-next-line no-new-func
      const result = new Function(`return ${expr}`)();
      
      setDisplay(String(result));
      setEquation('');
    } catch (e) {
      setDisplay('Error');
    }
  };

  const clear = () => {
    setDisplay('0');
    setEquation('');
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-white/80 backdrop-blur-md border border-white/40 shadow-lg rounded-full flex items-center justify-center text-gray-700 hover:bg-white transition-colors z-40"
      >
        <CalcIcon className="w-6 h-6" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            drag
            dragConstraints={{ left: -500, right: 0, top: -500, bottom: 0 }}
            dragElastic={0.1}
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="fixed bottom-24 right-6 w-72 bg-white/90 backdrop-blur-xl border border-white/50 shadow-2xl rounded-3xl overflow-hidden z-50 cursor-move"
          >
            <div className="p-4 bg-gray-50/50 border-b border-gray-200/50 flex justify-between items-center">
              <span className="font-semibold text-gray-700">Calculator</span>
              <button onClick={() => setIsOpen(false)} className="text-gray-500 hover:text-gray-800">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-4">
              <div className="bg-gray-100/50 rounded-xl p-3 mb-4 text-right">
                <div className="text-xs text-gray-500 h-4">{equation}</div>
                <div className="text-2xl font-semibold text-gray-800 tracking-wider overflow-x-auto">{display}</div>
              </div>
              
              <div className="grid grid-cols-4 gap-2">
                <button onClick={clear} className="col-span-2 p-3 rounded-xl bg-red-100/50 text-red-600 font-medium hover:bg-red-100 transition-colors">C</button>
                <button onClick={() => handleOperator('/')} className="p-3 rounded-xl bg-blue-50/50 text-blue-600 font-medium hover:bg-blue-100 transition-colors">÷</button>
                <button onClick={() => handleOperator('*')} className="p-3 rounded-xl bg-blue-50/50 text-blue-600 font-medium hover:bg-blue-100 transition-colors">×</button>
                
                {[7, 8, 9].map(n => (
                  <button key={n} onClick={() => handleNumber(String(n))} className="p-3 rounded-xl bg-white text-gray-800 font-medium shadow-sm hover:bg-gray-50 transition-colors">{n}</button>
                ))}
                <button onClick={() => handleOperator('-')} className="p-3 rounded-xl bg-blue-50/50 text-blue-600 font-medium hover:bg-blue-100 transition-colors">-</button>
                
                {[4, 5, 6].map(n => (
                  <button key={n} onClick={() => handleNumber(String(n))} className="p-3 rounded-xl bg-white text-gray-800 font-medium shadow-sm hover:bg-gray-50 transition-colors">{n}</button>
                ))}
                <button onClick={() => handleOperator('+')} className="p-3 rounded-xl bg-blue-50/50 text-blue-600 font-medium hover:bg-blue-100 transition-colors">+</button>
                
                {[1, 2, 3].map(n => (
                  <button key={n} onClick={() => handleNumber(String(n))} className="p-3 rounded-xl bg-white text-gray-800 font-medium shadow-sm hover:bg-gray-50 transition-colors">{n}</button>
                ))}
                <button onClick={calculate} className="row-span-2 p-3 rounded-xl bg-blue-500 text-white font-medium shadow-md hover:bg-blue-600 transition-colors">=</button>
                
                <button onClick={() => handleNumber('0')} className="col-span-2 p-3 rounded-xl bg-white text-gray-800 font-medium shadow-sm hover:bg-gray-50 transition-colors">0</button>
                <button onClick={() => handleNumber('.')} className="p-3 rounded-xl bg-white text-gray-800 font-medium shadow-sm hover:bg-gray-50 transition-colors">.</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
