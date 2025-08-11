import { exportLevels } from './export/scanner';

figma.showUI(__html__, { width: 800, height: 800 });

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'export') {
    try {
      figma.ui.postMessage({ type:'status', text:'Scanning levels…' });
      const data = await exportLevels();
      const json = JSON.stringify({ version: '1.0.0', levels: data }, null, 2);
      figma.ui.postMessage({ type:'done', json, levels: data });
    } catch (e: any) {
      figma.ui.postMessage({ type:'error', text: e.message });
    }
  }
};
