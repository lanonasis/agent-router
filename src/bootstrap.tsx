
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const mount = (el: HTMLElement) => {
  const root = createRoot(el);
  root.render(<App />);
  
  return {
    unmount: () => {
      root.unmount();
    }
  };
};

// If we're in development and running in isolation
if (process.env.NODE_ENV === 'development') {
  const devRoot = document.getElementById('root');
  if (devRoot) {
    mount(devRoot);
  }
}

// We're running through container, export the mount function
export { mount };
