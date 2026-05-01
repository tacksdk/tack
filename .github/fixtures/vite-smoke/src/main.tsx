import { createRoot } from 'react-dom/client';
import * as tack from '@tacksdk/js';
import * as headless from '@tacksdk/js/headless';
import * as tackReact from '@tacksdk/react';

const used = [tack, headless, tackReact].map((m) => Object.keys(m).length).join(',');

createRoot(document.getElementById('root')!).render(<div>{used}</div>);
