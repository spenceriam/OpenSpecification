'use client'

import { useState, useEffect, useCallback } from 'react'

const API_KEY_STORAGE_KEY = 'openspec-api-key'
const API_KEY_TESTED_KEY = 'openspec-api-key-tested'

export function useSimpleApiKeyStorage() {
  const [apiKey, setApiKeyState] = useState<string | null>(null)
  const [isValidated, setIsValidated] = useState(false)
  
  // Initialize from storage on mount only
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Check if we just did a reset - if so, don't load from storage
      const justReset = sessionStorage.getItem('openspec-just-reset')
      if (justReset) {
        console.log('=== API KEY HOOK: Detected reset flag, not loading from storage ===')
        setApiKeyState(null)
        setIsValidated(false)
        return
      }
      
      const key = sessionStorage.getItem(API_KEY_STORAGE_KEY)
      const tested = sessionStorage.getItem(API_KEY_TESTED_KEY)
      
      console.log('=== API KEY HOOK: Loading from storage ===', { key: key ? 'present' : 'null', tested })
      setApiKeyState(key)
      setIsValidated(tested === 'true')
    }
  }, [])
  
  // Listen for storage changes to sync state across hook instances
  useEffect(() => {
    if (typeof window === 'undefined') return
    
    const handleStorageChange = () => {
      const key = sessionStorage.getItem(API_KEY_STORAGE_KEY)
      const tested = sessionStorage.getItem(API_KEY_TESTED_KEY)
      
      setApiKeyState(key)
      setIsValidated(tested === 'true')
    }
    
    // Listen for storage changes from other tabs (though unlikely in this app)
    window.addEventListener('storage', handleStorageChange)
    
    // Listen for custom events from within the same tab (our use case)
    window.addEventListener('openspec-api-key-change', handleStorageChange)
    
    return () => {
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener('openspec-api-key-change', handleStorageChange)
    }
  }, [])
  
  const setAPIKey = useCallback((key: string) => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(API_KEY_STORAGE_KEY, key)
      sessionStorage.setItem(API_KEY_TESTED_KEY, 'true')
      // Emit custom event to sync all hook instances
      window.dispatchEvent(new CustomEvent('openspec-api-key-change'))
    }
    setApiKeyState(key)
    setIsValidated(true)
  }, [])
  
  const clearAPIKey = useCallback(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(API_KEY_STORAGE_KEY)
      sessionStorage.removeItem(API_KEY_TESTED_KEY)
      // Emit custom event to sync all hook instances
      window.dispatchEvent(new CustomEvent('openspec-api-key-change'))
    }
    setApiKeyState(null)
    setIsValidated(false)
  }, [])
  
  // Simple validation check
  const isValidFormat = apiKey ? apiKey.startsWith('sk-or-v1-') : false
  const hasValidKey = Boolean(apiKey && isValidFormat && isValidated)
  
  return {
    value: apiKey,
    hasValidKey,
    setAPIKey,
    clearAPIKey,
    isValidFormat
  }
}