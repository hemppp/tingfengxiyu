import React from 'react';
import { Link } from 'react-router-dom';
import { Compass, Home, BookOpen } from 'lucide-react';
import { PATHS } from './paths';

/**
 * 404 兜底页 — 极简风格，符合"空山雨后"主题。
 */
export const NotFoundPage: React.FC = () => (
  <div className='h-full flex items-center justify-center' style={{ background: 'transparent' }}>
    <div className='text-center max-w-md px-6'>
      <div className='mx-auto mb-6 w-20 h-20 rounded-full flex items-center justify-center bg-card/60 backdrop-blur border border-border/40'>
        <Compass size={36} className='text-muted-foreground' />
      </div>
      <h1 className='font-[Noto_Serif_SC,serif] text-5xl text-foreground mb-3 tracking-wider'>404</h1>
      <p className='text-lg text-muted-foreground mb-2 font-[Noto_Serif_SC,serif]'>此路不通 · 山径已隐</p>
      <p className='text-sm text-muted-foreground/70 mb-8'>你寻找的页面已不在此处</p>
      <div className='flex items-center justify-center gap-3'>
        <Link
          to={PATHS.bookshelf}
          className='inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-card/60 backdrop-blur border border-border/40 text-sm text-foreground hover:bg-card transition-colors'
        >
          <BookOpen size={14} />
          返回书架
        </Link>
        <Link
          to={PATHS.root}
          className='inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors'
        >
          <Home size={14} />
          主页
        </Link>
      </div>
    </div>
  </div>
);
