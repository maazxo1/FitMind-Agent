export function readLS<T>(key: string, fallback: T): T {
  try {
    const val = JSON.parse(localStorage.getItem(key) ?? 'null')
    return (val ?? fallback) as T
  } catch {
    localStorage.removeItem(key)
    return fallback
  }
}
