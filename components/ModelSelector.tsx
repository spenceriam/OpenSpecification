'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { 
  ChevronDown, 
  Check, 
  Search, 
  Zap, 
  Eye, 
  DollarSign, 
  Clock, 
  Cpu, 
  AlertCircle,
  Loader2,
  Filter,
  Star
} from 'lucide-react'
import { OpenRouterModel } from '@/types'
import { useSimpleApiKeyStorage } from '../hooks/useSimpleApiKeyStorage'
import { OpenRouterClient } from '@/lib/openrouter/client'
import { filterModels, searchModels, categorizeModels, formatPrice } from '@/lib/openrouter/model-utils'

interface ModelSelectorProps {
  selectedModel?: OpenRouterModel
  onModelSelect: (model: OpenRouterModel) => void
  onLoadingChange?: (loading: boolean) => void
  onError?: () => void
  showCapabilities?: boolean
  showPricing?: boolean
  filterByCapability?: 'vision' | 'reasoning' | 'coding' | 'all'
  className?: string
}

type SortOption = 'latest' | 'name-az' | 'name-za' | 'cost-low' | 'cost-high' | 'popularity'

export function ModelSelector({
  selectedModel,
  onModelSelect,
  onLoadingChange,
  onError,
  showCapabilities = true,
  showPricing = true,
  filterByCapability = 'all',
  className = ''
}: ModelSelectorProps) {
  const { value: apiKey, isValidFormat: isApiKeyValidFormat } = useSimpleApiKeyStorage()
  const [models, setModels] = useState<OpenRouterModel[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<SortOption>('popularity')
  const [showFreeOnly, setShowFreeOnly] = useState(false)

  // Fetch available models
  const fetchModels = useCallback(async () => {
    if (!apiKey) {
      setError('API key required to load models')
      return
    }

    // Check if API key has valid format
    if (!isApiKeyValidFormat) {
      setError('Invalid API key format. OpenRouter API keys must start with "sk-or-v1-"')
      onError?.()
      return
    }

    setIsLoading(true)
    setError(null)
    onLoadingChange?.(true)

    try {
      const client = new OpenRouterClient(apiKey)
      const fetchedModels = await client.listModels()
      
      if (fetchedModels.length === 0) {
        setError('No models available with current API key')
        onError?.()
      } else {
        setModels(fetchedModels)
      }
    } catch (err) {
      let errorMessage = 'Failed to load models'
      
      if (err instanceof Error) {
        if (err.message.includes('401') || err.message.includes('403')) {
          errorMessage = 'Invalid API key - authentication failed. Please check your OpenRouter API key.'
        } else if (err.message.includes('429')) {
          errorMessage = 'Rate limit exceeded. Please wait before trying again.'
        } else if (err.message.includes('Network') || err.message.includes('fetch')) {
          errorMessage = 'Network error - could not connect to OpenRouter. Please check your internet connection.'
        } else {
          errorMessage = err.message
        }
      }
      
      setError(errorMessage)
      onError?.()
    } finally {
      setIsLoading(false)
      onLoadingChange?.(false)
    }
  }, [apiKey, isApiKeyValidFormat, onError, onLoadingChange])

  // Load models when component mounts or API key changes
  useEffect(() => {
    if (apiKey) {
      fetchModels()
    } else {
      setModels([])
      setError(null)
    }
  }, [apiKey]) // Removed fetchModels from dependency array to prevent infinite loop

  // Helper function to check if model is free
  const isFreeModel = (model: OpenRouterModel): boolean => {
    return parseFloat(model.pricing?.prompt?.toString() || '0') === 0 &&
           parseFloat(model.pricing?.completion?.toString() || '0') === 0
  }

  // Helper function to format creation date
  const formatCreationDate = (created?: string | number): string => {
    if (!created) return ''
    
    // Handle Unix timestamp (seconds since epoch)
    const timestamp = typeof created === 'string' ? parseInt(created) : created
    
    // If timestamp is in seconds, convert to milliseconds
    const date = new Date(timestamp * 1000)
    
    // Check if date is valid
    if (isNaN(date.getTime())) return ''
    
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    })
  }

  // Helper function to check file support
  const supportsFiles = (model: OpenRouterModel): boolean => {
    if (model.supports_files) return true
    
    // Check if model supports images (can handle file attachments)
    const hasImageInput = model.architecture?.input_modalities?.includes('image') ||
                         model.architecture?.input_modalities?.includes('file')
    
    // Check modality string for vision/image support
    const modalityString = Array.isArray(model.architecture?.modality) 
      ? model.architecture.modality.join(',') 
      : model.architecture?.modality || ''
    
    const hasVisionInModality = modalityString.includes('image') || 
                               modalityString.includes('vision')
    
    return Boolean(hasImageInput || hasVisionInModality)
  }

  // Filter and sort models
  const filteredAndSortedModels = useMemo(() => {
    let result = [...models]

    // Apply search filter
    if (searchQuery.trim()) {
      result = searchModels(result, searchQuery)
    }

    // Apply free models filter
    if (showFreeOnly) {
      result = result.filter(isFreeModel)
    }

    // Apply capability filter
    if (filterByCapability !== 'all') {
      result = filterModels(result, { capability: filterByCapability })
    }

    // Apply category filter
    if (categoryFilter !== 'all') {
      const categorized = categorizeModels(result)
      result = categorized[categoryFilter] || []
    }

    // Sort models
    result.sort((a, b) => {
      switch (sortBy) {
        case 'latest':
          // Sort by created date if available, fallback to popularity
          const aDate = new Date(a.created || 0).getTime()
          const bDate = new Date(b.created || 0).getTime()
          if (aDate && bDate) {
            return bDate - aDate
          }
          return (b.top_provider?.popularity || 0) - (a.top_provider?.popularity || 0)
        case 'name-az':
          return a.name.localeCompare(b.name)
        case 'name-za':
          return b.name.localeCompare(a.name)
        case 'cost-low':
          return (parseFloat(a.pricing?.prompt?.toString() || '0')) - (parseFloat(b.pricing?.prompt?.toString() || '0'))
        case 'cost-high':
          return (parseFloat(b.pricing?.prompt?.toString() || '0')) - (parseFloat(a.pricing?.prompt?.toString() || '0'))
        case 'popularity':
        default:
          return (b.top_provider?.popularity || 0) - (a.top_provider?.popularity || 0)
      }
    })

    return result
  }, [models, searchQuery, filterByCapability, categoryFilter, sortBy, showFreeOnly])

  // Get model categories for filter
  const modelCategories = useMemo(() => {
    if (models.length === 0) return {}
    return categorizeModels(models)
  }, [models])

  // Handle model selection
  const handleModelSelect = (model: OpenRouterModel) => {
    onModelSelect(model)
  }

  // Render model capability badges
  const renderCapabilityBadges = (model: OpenRouterModel) => {
    const badges = []

    if (model.architecture?.modality?.includes('vision')) {
      badges.push(
        <Badge key="vision" variant="secondary" className="text-xs">
          <Eye className="h-3 w-3 mr-1" />
          Vision
        </Badge>
      )
    }

    if (model.name.toLowerCase().includes('reasoning') || 
        model.description?.toLowerCase().includes('reasoning')) {
      badges.push(
        <Badge key="reasoning" variant="secondary" className="text-xs">
          <Zap className="h-3 w-3 mr-1" />
          Reasoning
        </Badge>
      )
    }

    if (model.name.toLowerCase().includes('code') || 
        model.description?.toLowerCase().includes('code')) {
      badges.push(
        <Badge key="coding" variant="secondary" className="text-xs">
          <Cpu className="h-3 w-3 mr-1" />
          Coding
        </Badge>
      )
    }

    return badges
  }


  // Render model item
  const renderModelItem = (model: OpenRouterModel) => {
    const isSelected = selectedModel?.id === model.id
    const isPopular = (model.top_provider?.popularity || 0) > 50
    const modelIsFree = isFreeModel(model)
    const hasFileSupport = supportsFiles(model)
    const creationDate = formatCreationDate(model.created)
    
    // Format pricing per 1M tokens like OpenRouter
    const promptPrice = parseFloat(model.pricing?.prompt?.toString() || '0')
    const completionPrice = parseFloat(model.pricing?.completion?.toString() || '0')
    
    return (
      <div
        key={model.id}
        onClick={() => handleModelSelect(model)}
        className={`flex items-start gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors ${
          isSelected ? 'bg-primary/20 border-l-2 border-primary' : ''
        }`}
      >
        <Check
          className={`h-4 w-4 text-primary flex-shrink-0 mt-0.5 ${
            isSelected ? 'opacity-100' : 'opacity-0'
          }`}
        />
        
        <div className="flex-1 min-w-0 space-y-1">
          {/* Model name and badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-foreground">{model.name}</span>
            {modelIsFree && (
              <Badge variant="secondary" className="text-xs bg-green-900/20 text-green-400 border-green-700">
                Free
              </Badge>
            )}
            {isPopular && (
              <Badge variant="outline" className="text-xs">
                <Star className="h-3 w-3 mr-1" />
                Popular
              </Badge>
            )}
            {hasFileSupport && (
              <Badge variant="outline" className="text-xs bg-blue-900/20 text-blue-400 border-blue-700">
                Files
              </Badge>
            )}
          </div>
          
          {/* Detailed info line */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            {creationDate && (
              <span>Created {creationDate}</span>
            )}
            {model.context_length && (
              <span>{(model.context_length / 1000).toLocaleString()}K context</span>
            )}
            {!modelIsFree && (
              <>
                <span>${(promptPrice * 1000000).toFixed(2)}/M input tokens</span>
                <span>${(completionPrice * 1000000).toFixed(2)}/M output tokens</span>
              </>
            )}
          </div>
          
          {/* Description if there's space and it exists */}
          {model.description && (
            <p className="text-xs text-muted-foreground/80 line-clamp-2 mt-1">
              {model.description}
            </p>
          )}
        </div>
      </div>
    )
  }

  if (!apiKey) {
    return (
      <Card className={`model-selector ${className}`}>
        <CardContent className="pt-6">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Please enter your OpenRouter API key to view available models.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    )
  }


  return (
    <Card className={`model-selector max-w-5xl ${className}`}>
      <CardHeader className="pb-4">
        <CardTitle className="text-base text-foreground">Select AI Model</CardTitle>
        <CardDescription className="text-sm">
          {selectedModel ? (
            <span className="text-green-400 font-medium">Selected: {selectedModel.name}</span>
          ) : (
            `Choose from ${models.length} available models`
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Loading state */}
        {isLoading && models.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center space-y-3">
              <Loader2 className="h-6 w-6 mx-auto animate-spin text-primary" />
              <div className="text-sm text-muted-foreground">Loading available models...</div>
            </div>
          </div>
        )}

        {/* Search and filters - always visible when we have models */}
        {models.length > 0 && (
          <div className="space-y-3">
            {/* Search Box */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search models..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            
            {/* Filters Row */}
            <div className="flex gap-2 flex-wrap items-center">
              {/* Sort Dropdown */}
              <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortOption)}>
                <SelectTrigger className="w-[120px] h-8 text-xs">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="popularity">Most Popular</SelectItem>
                  <SelectItem value="latest">Latest</SelectItem>
                  <SelectItem value="name-az">Name: A-Z</SelectItem>
                  <SelectItem value="name-za">Name: Z-A</SelectItem>
                  <SelectItem value="cost-low">Cost: $ → $$$</SelectItem>
                  <SelectItem value="cost-high">Cost: $$$ → $</SelectItem>
                </SelectContent>
              </Select>

              {/* Category Filter */}
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[140px] h-8 text-xs">
                  <div className="flex items-center gap-1">
                    <Filter className="h-3 w-3" />
                    <SelectValue placeholder="All Categories" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {Object.keys(modelCategories).map((category) => (
                    <SelectItem key={category} value={category}>
                      {category} ({modelCategories[category].length})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Free Models Checkbox */}
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="free-only" 
                  checked={showFreeOnly}
                  onCheckedChange={setShowFreeOnly}
                />
                <label 
                  htmlFor="free-only" 
                  className="text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Free only
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Model list - always visible when we have models */}
        {models.length > 0 && (
          <div className="border rounded-lg h-64 overflow-y-auto">
            {filteredAndSortedModels.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                {error ? (
                  <div className="text-center">
                    <AlertCircle className="h-5 w-5 mx-auto mb-2 text-destructive" />
                    <div className="text-xs text-destructive mb-2">{error}</div>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={fetchModels}
                      disabled={isLoading}
                    >
                      {isLoading ? 'Retrying...' : 'Retry'}
                    </Button>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground/70">
                    No models found matching your criteria.
                  </div>
                )}
              </div>
            ) : (
              <div className="divide-y">
                {filteredAndSortedModels.map(renderModelItem)}
              </div>
            )}
          </div>
        )}

        {/* Model statistics */}
        {models.length > 0 && (
          <div className="text-xs text-muted-foreground/70 flex items-center justify-between">
            <span>
              Showing {filteredAndSortedModels.length} of {models.length} models
              {searchQuery && ` matching "${searchQuery}"`}
              {showFreeOnly && ' (free only)'}
            </span>
            {showFreeOnly && (
              <span className="text-green-400 font-medium">
                {filteredAndSortedModels.filter(isFreeModel).length} free models
              </span>
            )}
          </div>
        )}

        {error && !isLoading && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="flex items-center justify-between">
                <span>{error}</span>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={fetchModels}
                  disabled={isLoading}
                >
                  Retry
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

export default ModelSelector