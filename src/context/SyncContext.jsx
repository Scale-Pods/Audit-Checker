import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

const SyncContext = createContext(null)

export const useSync = () => useContext(SyncContext)

export const SyncProvider = ({ children }) => {
  const handlersRef = useRef(new Set())
  const [isSyncing, setIsSyncing] = useState(false)

  const registerRefresh = useCallback((handler) => {
    handlersRef.current.add(handler)
    return () => {
      handlersRef.current.delete(handler)
    }
  }, [])

  const syncNow = useCallback(async () => {
    setIsSyncing(true)
    try {
      await Promise.allSettled([...handlersRef.current].map((handler) => handler()))
    } finally {
      setIsSyncing(false)
    }
  }, [])

  const value = useMemo(
    () => ({ isSyncing, syncNow, registerRefresh }),
    [isSyncing, syncNow, registerRefresh]
  )

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}

export const useSyncRefresh = (handler) => {
  const { registerRefresh } = useSync()
  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => registerRefresh(() => handlerRef.current()), [registerRefresh])
}
