import React from 'react';
import clsx from 'clsx';

const LOGO_SRC = '/institute-logo.png';

type InstituteLogoProps = {
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
};

const sizeClasses = {
  xs: 'h-7 w-7 sm:h-8 sm:w-8',
  sm: 'h-9 w-9 sm:h-10 sm:w-10',
  md: 'h-14 w-14 sm:h-16 sm:w-16',
  lg: 'h-20 w-20 sm:h-24 sm:w-24',
};

export function InstituteLogo({ className, size = 'sm' }: InstituteLogoProps) {
  return (
    <img
      src={LOGO_SRC}
      alt="Farg‘ona jamoat salomatligi tibbiyot instituti logotipi"
      className={clsx('object-contain rounded-full shadow-md ring-1 ring-black/5', sizeClasses[size], className)}
      width={256}
      height={256}
      decoding="async"
    />
  );
}

export { LOGO_SRC };
