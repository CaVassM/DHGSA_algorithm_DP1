const CONFIG = {
  verde: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/40' },
  ambar: { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/40' },
  rojo:  { bg: 'bg-red-500/20',   text: 'text-red-400',   border: 'border-red-500/40'   },
  azul:  { bg: 'bg-blue-500/20',  text: 'text-blue-400',  border: 'border-blue-500/40'  },
}

export default function SemaforoBadge({ color, label, className = '' }) {
  const c = CONFIG[color] ?? CONFIG.azul
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${c.bg} ${c.text} ${c.border} ${className}`}>
      {label}
    </span>
  )
}
