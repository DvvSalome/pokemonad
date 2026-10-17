// Iconos dibujados del HUD: SVG de colores planos con contorno oscuro, al estilo de los botones de consola.
import React from 'react';

const O = '#15233b';
type P = { size?: number };
const svg = (size: number, children: React.ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke={O} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
    {children}
  </svg>
);

export const IconDex: React.FC<P> = ({ size = 30 }) => svg(size, <>
  <rect x="6" y="4" width="20" height="24" rx="3.5" fill="#ff4f6d" />
  <path d="M6 16h20" />
  <rect x="6" y="16" width="20" height="12" rx="3.5" fill="#fff" />
  <circle cx="16" cy="16" r="4.2" fill="#fff" />
  <circle cx="16" cy="16" r="1.6" fill={O} stroke="none" />
</>);

export const IconBox: React.FC<P> = ({ size = 30 }) => svg(size, <>
  <rect x="9" y="4" width="17" height="22" rx="3" fill="#8ec5ff" transform="rotate(10 17 15)" />
  <rect x="6" y="6" width="17" height="22" rx="3" fill="#ffd84a" />
  <circle cx="14.5" cy="14" r="4" fill="#fff" />
  <path d="M10 22.5h9" />
</>);

export const IconBag: React.FC<P> = ({ size = 30 }) => svg(size, <>
  <path d="M11 9V7.5a5 5 0 0 1 10 0V9" />
  <rect x="5.5" y="9" width="21" height="19" rx="5" fill="#f2994a" />
  <rect x="10" y="17" width="12" height="7" rx="2" fill="#ffd9a8" />
  <path d="M16 17v2.5" />
</>);

export const IconMart: React.FC<P> = ({ size = 30 }) => svg(size, <>
  <rect x="6" y="14" width="20" height="14" rx="2" fill="#fff" />
  <path d="M4 14l2.5-8h19L28 14z" fill="#2e59c0" />
  <path d="M10.5 6L9 14M16 6v8M21.5 6L23 14" />
  <rect x="13" y="19" width="6" height="9" rx="1" fill="#8ec5ff" />
</>);

export const IconLeague: React.FC<P> = ({ size = 30 }) => svg(size, <>
  <path d="M10 5h12v7a6 6 0 0 1-12 0z" fill="#ffc72c" />
  <path d="M10 8H6a4 4 0 0 0 4 5M22 8h4a4 4 0 0 1-4 5" />
  <path d="M16 18v4" />
  <rect x="10.5" y="22" width="11" height="5" rx="1.5" fill="#b07b2c" />
</>);

export const IconMenu: React.FC<P> = ({ size = 30 }) => svg(size, <>
  <rect x="5" y="5" width="9" height="9" rx="2.5" fill="#fff" />
  <rect x="18" y="5" width="9" height="9" rx="2.5" fill="#fff" />
  <rect x="5" y="18" width="9" height="9" rx="2.5" fill="#fff" />
  <rect x="18" y="18" width="9" height="9" rx="2.5" fill="#fff" />
</>);

export const IconWallet: React.FC<P> = ({ size = 20 }) => svg(size, <>
  <rect x="4" y="8" width="24" height="18" rx="4" fill="#8e44ec" />
  <path d="M7 8l13-4 2 4" />
  <rect x="19" y="14" width="9" height="6" rx="2" fill="#fff" />
  <circle cx="22.5" cy="17" r="1.1" fill={O} stroke="none" />
</>);

export const IconMissions: React.FC<P> = ({ size = 30 }) => svg(size, <>
  <circle cx="16" cy="16" r="12" fill="#ff7a45" />
  <circle cx="16" cy="16" r="7.6" fill="#fff" />
  <circle cx="16" cy="16" r="3.4" fill="#ff7a45" />
  <path d="M16 16l9-9M22 6.5l3.2.3.3 3.2" />
</>);

export const IconMap: React.FC<P> = ({ size = 30 }) => svg(size, <>
  <path d="M4 8l7-3 10 3 7-3v19l-7 3-10-3-7 3z" fill="#9fe0a8" />
  <path d="M11 5v19M21 8v19" />
  <path d="M14.5 13.5c1.5-2.5 5-2.5 5 0 0 2-2.5 4-2.5 4s-2.5-2-2.5-4z" fill="#ff4f6d" />
</>);

export const IconTrainers: React.FC<P> = ({ size = 30 }) => svg(size, <>
  <path d="M5 19a11 9 0 0 1 22 0z" fill="#ff4f6d" />
  <path d="M5 19h22" />
  <path d="M3 19h26l-2.5 4H10z" fill="#fff" />
  <circle cx="16" cy="13.5" r="3" fill="#fff" />
</>);

export const IconBattle: React.FC<P> = ({ size = 30 }) => svg(size, <>
  <path d="M5 5l14 14-2 2L3 7V5z" fill="#dce9f7" />
  <path d="M27 5L13 19l2 2L29 7V5z" fill="#dce9f7" />
  <path d="M8 20l4 4M24 20l-4 4M6 26l3-3M26 26l-3-3" />
  <circle cx="7" cy="25" r="2" fill="#ffc72c" />
  <circle cx="25" cy="25" r="2" fill="#ffc72c" />
</>);

export const IconMarket: React.FC<P> = ({ size = 30 }) => svg(size, <>
  <rect x="5" y="9" width="14" height="19" rx="2.5" fill="#8ec5ff" transform="rotate(-10 12 18)" />
  <rect x="13" y="6" width="14" height="19" rx="2.5" fill="#fff" />
  <path d="M20 11v9M17.5 13.2c0-1.2 1.1-1.7 2.5-1.7s2.5.6 2.5 1.6c0 2.3-5 1.3-5 3.6 0 1 1.1 1.6 2.5 1.6s2.5-.5 2.5-1.7" />
</>);

export const IconTrade: React.FC<P> = ({ size = 30 }) => svg(size, <>
  <circle cx="16" cy="16" r="12" fill="#19b3a6" />
  <path d="M9 13h13l-3.5-3.5M23 19H10l3.5 3.5" stroke="#fff" strokeWidth="2.6" />
</>);

export const IconToken: React.FC<P> = ({ size = 30 }) => svg(size, <>
  <circle cx="16" cy="16" r="12" fill="#ffc72c" />
  <circle cx="16" cy="16" r="8" fill="#ffe98a" />
  <path d="M13 12.5h6M16 12.5v8" />
</>);

export const IconAccount: React.FC<P> = ({ size = 30 }) => svg(size, <>
  <circle cx="11" cy="16" r="6.5" fill="#ffd84a" />
  <circle cx="11" cy="16" r="2.2" fill="#fff" />
  <path d="M17.5 16H28v4M24 16v3" />
</>);

export const IconLegal: React.FC<P> = ({ size = 30 }) => svg(size, <>
  <path d="M8 4h13l5 5v19H8z" fill="#fff" />
  <path d="M21 4v5h5" fill="#dce9f7" />
  <path d="M12 14h9M12 18h9M12 22h6" />
</>);

export const IconAdmin: React.FC<P> = ({ size = 30 }) => svg(size, <>
  <path d="M16 3.5l10 4v7c0 7-4.5 11.5-10 14-5.5-2.5-10-7-10-14v-7z" fill="#4c9bff" />
  <path d="M11.5 16l3.2 3.2 6-6.4" stroke="#fff" strokeWidth="2.8" />
</>);

export const IconEgg: React.FC<P> = ({ size = 30 }) => svg(size, <>
  <path d="M16 3.5c5.5 0 9.5 8.3 9.5 14.2 0 6-4.3 10.8-9.5 10.8S6.5 23.7 6.5 17.7C6.5 11.8 10.5 3.5 16 3.5z" fill="#dce9f7" />
  <circle cx="12.5" cy="14" r="2.2" fill="#5983ca" stroke="none" />
  <circle cx="19.5" cy="19.5" r="2.8" fill="#5983ca" stroke="none" />
  <circle cx="18" cy="10" r="1.5" fill="#5983ca" stroke="none" />
</>);
