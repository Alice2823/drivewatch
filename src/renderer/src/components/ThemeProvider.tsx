import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'

interface ThemeContextType {
  isDarkMode: boolean
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType>({
  isDarkMode: true,
  toggleTheme: () => {}
})

export function useTheme(): ThemeContextType {
  return useContext(ThemeContext)
}

export function ThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('drivewatch-theme')
      return saved ? saved === 'dark' : true // default dark
    } catch {
      return true
    }
  })

  useEffect(() => {
    const root = document.documentElement
    if (isDarkMode) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    try {
      localStorage.setItem('drivewatch-theme', isDarkMode ? 'dark' : 'light')
    } catch {
      // localStorage not available
    }
  }, [isDarkMode])

  const toggleTheme = useCallback(() => {
    setIsDarkMode(prev => !prev)
  }, [])

  return (
    <ThemeContext.Provider value={{ isDarkMode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
