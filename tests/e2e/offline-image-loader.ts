'use client';
import type {ImageLoaderProps} from 'next/image';
export default function offlineImage({src,width,quality}:ImageLoaderProps){const path=/^https?:\/\//.test(src)?'/window.svg':src;return `${path}${path.includes('?')?'&':'?'}w=${width}&q=${quality||75}`;}
