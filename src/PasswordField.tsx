import { InputHTMLAttributes, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

export default function PasswordField(props: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false)
  return <span className="password-field">
    <input {...props} type={visible ? 'text' : 'password'} />
    <button type="button" className="password-toggle" aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setVisible(v => !v)}>
      {visible ? <EyeOff size={18}/> : <Eye size={18}/>} 
    </button>
  </span>
}
