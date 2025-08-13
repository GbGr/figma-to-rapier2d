import { exportLevels } from './export/scanner';

figma.showUI(__html__, { width: 1080, height: 1080 });

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'export') {
    try {
      const ppmRaw = Number(msg.ppm);
      const ppm = Number.isFinite(ppmRaw) && ppmRaw > 0 ? ppmRaw : 1; // default
      figma.ui.postMessage({ type:'status', text:'Scanning levels…' });
      const data = await exportLevels(ppm);
      const json = JSON.stringify({ version: '1.0.0', levels: data }, null, 2);
      figma.ui.postMessage({ type:'done', json, levels: data });
    } catch (e: any) {
      figma.ui.postMessage({ type:'error', text: e.message });
    }
  }
};
