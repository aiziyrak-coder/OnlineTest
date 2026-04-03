import React from 'react';

export const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link', size?: 'default' | 'sm' | 'lg' | 'icon' }>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    const baseStyles = "inline-flex items-center justify-center whitespace-nowrap rounded-full text-sm font-medium transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 disabled:pointer-events-none disabled:opacity-50 active:scale-95";
    const variants = {
      default: "bg-black/90 text-white hover:bg-black/80 shadow-md backdrop-blur-md border border-white/20",
      destructive: "bg-red-500/90 text-white hover:bg-red-600/90 shadow-md backdrop-blur-md border border-white/20",
      outline: "border border-black/10 bg-white/30 backdrop-blur-xl hover:bg-white/50 text-black shadow-sm",
      secondary: "bg-black/5 backdrop-blur-md text-black hover:bg-black/10",
      ghost: "hover:bg-black/5 text-gray-800",
      link: "text-blue-600 underline-offset-4 hover:underline",
    };
    const sizes = {
      default: "h-12 px-6 py-2",
      sm: "h-9 px-4 text-xs",
      lg: "h-14 px-8 text-base",
      icon: "h-12 w-12",
    };
    return (
      <button
        ref={ref}
        className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className || ''}`}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={`flex h-12 w-full rounded-2xl border border-white/50 bg-white/50 backdrop-blur-xl px-4 py-2 text-sm text-gray-900 shadow-inner placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:bg-white/80 transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-50 ${className || ''}`}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export const Card = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`glass-panel ${className || ''}`} {...props} />
);

export const CardHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`flex flex-col space-y-1.5 p-6 ${className || ''}`} {...props} />
);

export const CardTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={`font-semibold text-lg leading-none tracking-tight ${className || ''}`} {...props} />
);

export const CardContent = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`p-6 pt-0 ${className || ''}`} {...props} />
);
