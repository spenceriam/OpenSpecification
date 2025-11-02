'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { 
  SpecState, 
  WorkflowPhase, 
  ApprovalState, 
  ContextFile, 
  RefinementRequest,
  RefinementHistory 
} from '@/types'
import { useLocalStorage } from './useLocalStorage'
import { useSimpleApiKeyStorage } from './useSimpleApiKeyStorage'

const DEFAULT_SPEC_STATE: SpecState = {
  phase: 'requirements',
  featureName: '',
  description: '',
  requirements: '',
  design: '',
  tasks: '',
  context: [],
  isGenerating: false,
  error: null,
  approvals: {
    requirements: false,
    design: false,
    tasks: false
  },
  // NEW: Timing tracking for each phase
  timing: {
    requirements: { startTime: 0, endTime: 0, elapsed: 0 },
    design: { startTime: 0, endTime: 0, elapsed: 0 },
    tasks: { startTime: 0, endTime: 0, elapsed: 0 }
  },
  // NEW: API response tracking for cost/token info
  apiResponses: {
    requirements: null,
    design: null,
    tasks: null
  }
}

export interface UseSpecWorkflowOptions {
  autoSave?: boolean
  selectedModel?: { id: string; name: string } | null
  onPhaseChange?: (newPhase: WorkflowPhase, oldPhase: WorkflowPhase) => void
  onGenerationStart?: (phase: WorkflowPhase) => void
  onGenerationComplete?: (phase: WorkflowPhase, content: string) => void
  onError?: (error: Error, phase: WorkflowPhase) => void
}

export interface UseSpecWorkflowReturn {
  // State
  state: SpecState
  refinementHistory: RefinementHistory[]
  
  // Phase management
  currentPhase: WorkflowPhase
  canProceedToNext: boolean
  canGoBack: boolean
  nextPhase: WorkflowPhase | null
  previousPhase: WorkflowPhase | null
  
  // Basic actions
  setFeatureName: (name: string) => void
  setDescription: (description: string) => void
  addContextFile: (file: ContextFile) => void
  removeContextFile: (fileId: string) => void
  clearContext: () => void
  
  // Generation actions
  generateCurrentPhase: () => Promise<void>
  generateWithData: (featureName: string, description: string, contextFiles: ContextFile[]) => Promise<void>
  refineCurrentPhase: (feedback: string) => Promise<void>
  
  // Approval and progression
  approveCurrentPhase: () => void
  rejectCurrentPhase: () => void
  proceedToNextPhase: () => void
  approveAndProceed: () => Promise<void>
  goToPreviousPhase: () => void
  
  // Content management
  updatePhaseContent: (phase: WorkflowPhase, content: string) => void
  getPhaseContent: (phase: WorkflowPhase) => string
  
  // Utility actions
  reset: () => void
  resetProjectOnly: () => void
  clearError: () => void
  exportData: () => any
  importData: (data: any) => boolean
  forceSync: () => void
  
  // Test-compatible API aliases and additional methods
  generateContent: (phase: WorkflowPhase, prompt: string, model: string) => Promise<void>
  refineContent: (phase: WorkflowPhase, feedback: string, model: string) => Promise<void>
  setCurrentPhase: (phase: WorkflowPhase) => void
  updateApproval: (phase: WorkflowPhase, status: 'approved' | 'pending') => void
  progressToNextPhase: () => void
  resetWorkflow: () => void
  setError: (message: string) => void
  canProgressToNextPhase: () => boolean
  isWorkflowComplete: () => boolean
  isGenerating: boolean
  error: string | null
  phaseContent: {
    requirements: string
    design: string
    tasks: string
  }
  approvals: {
    requirements: 'approved' | 'pending'
    design: 'approved' | 'pending'
    tasks: 'approved' | 'pending'
  }
}

// Helper function to detect if prompt has significantly changed
function hasPromptChanged(storedDescription: string, newDescription: string, storedFeatureName: string, newFeatureName: string): boolean {
  if (!storedDescription && !newDescription) return false
  if (!storedDescription || !newDescription) return Boolean(storedDescription !== newDescription)
  
  // Extract key information for comparison
  const normalizeText = (text: string) => text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
  const getKeyWords = (text: string) => normalizeText(text).split(/\s+/).filter(word => word.length > 3)
  
  const storedWords = getKeyWords(storedDescription)
  const newWords = getKeyWords(newDescription)
  const storedFeatureWords = getKeyWords(storedFeatureName || '')
  const newFeatureWords = getKeyWords(newFeatureName || '')
  
  // Check feature name similarity
  const featureNameChanged = storedFeatureName && newFeatureName && 
    normalizeText(storedFeatureName) !== normalizeText(newFeatureName)
  
  // Check if significant content has changed (less than 40% word overlap)
  const allStoredWords = [...storedWords, ...storedFeatureWords]
  const allNewWords = [...newWords, ...newFeatureWords]
  
  if (allStoredWords.length === 0 || allNewWords.length === 0) {
    return allStoredWords.length !== allNewWords.length
  }
  
  const intersection = allStoredWords.filter(word => allNewWords.includes(word))
  const overlap = intersection.length / Math.max(allStoredWords.length, allNewWords.length)
  
  const significantChange = overlap < 0.4 || Boolean(featureNameChanged)
  
  // Removed verbose logging for production
  
  return significantChange
}

export function useSpecWorkflow(options: UseSpecWorkflowOptions = {}): UseSpecWorkflowReturn {
  const {
    autoSave = true,
    selectedModel,
    onPhaseChange,
    onGenerationStart,
    onGenerationComplete,
    onError
  } = options

  // API key management
  const { value: apiKey, hasValidKey } = useSimpleApiKeyStorage()

  // Persistent state management with robust data migration
  const {
    value: state,
    setValue: setState,
    error: storageError,
    forceSync
  } = useLocalStorage('openspec-workflow-state', {
    defaultValue: DEFAULT_SPEC_STATE,
    autoSave,
    validateData: (data): data is SpecState => {
      // CRITICAL: Prevent phase regression in localStorage
      if (data && typeof data === 'object' && 'phase' in data) {
        // If we have requirements content but phase is 'requirements', this might be corrupted
        if (data.requirements && typeof data.requirements === 'string' && data.requirements.trim().length > 0) {
          if (data.phase === 'requirements') {
            console.warn('[Storage] Correcting phase regression - requirements exist but phase is requirements')
            // Don't auto-correct here, let the validation pass and we'll fix it in useEffect
          }
        }
      }
      if (!data || typeof data !== 'object') return false
      
      // Check for required basic fields
      const hasBasicFields = 'phase' in data && 'featureName' in data && 'description' in data && 'approvals' in data
      if (!hasBasicFields) return false
      
      // Migrate old data that might be missing timing or apiResponses
      const migratedData = data as any
      
      // Ensure timing structure exists
      if (!migratedData.timing) {
        console.log('[DataMigration] Creating missing timing structure')
        migratedData.timing = {
          requirements: { startTime: 0, endTime: 0, elapsed: 0 },
          design: { startTime: 0, endTime: 0, elapsed: 0 },
          tasks: { startTime: 0, endTime: 0, elapsed: 0 }
        }
      } else {
        // Fill in missing timing entries and validate structure
        ['requirements', 'design', 'tasks'].forEach(phase => {
          if (!migratedData.timing[phase] || typeof migratedData.timing[phase] !== 'object') {
            console.log(`[DataMigration] Fixing timing entry for ${phase}`)
            migratedData.timing[phase] = { startTime: 0, endTime: 0, elapsed: 0 }
          } else {
            // Ensure all required timing properties exist with proper types
            const timing = migratedData.timing[phase]
            if (typeof timing.startTime !== 'number') timing.startTime = 0
            if (typeof timing.endTime !== 'number') timing.endTime = 0
            if (typeof timing.elapsed !== 'number') timing.elapsed = 0
          }
        })
      }
      
      // Ensure apiResponses structure exists
      if (!migratedData.apiResponses) {
        console.log('[DataMigration] Creating missing apiResponses structure')
        migratedData.apiResponses = {
          requirements: null,
          design: null,
          tasks: null
        }
      } else {
        // Fill in missing apiResponse entries
        ['requirements', 'design', 'tasks'].forEach(phase => {
          if (!(phase in migratedData.apiResponses)) {
            console.log(`[DataMigration] Adding missing apiResponse for ${phase}`)
            migratedData.apiResponses[phase] = null
          }
        })
      }
      
      console.log('[DataMigration] Validated and migrated data:', {
        hasBasicFields,
        phase: migratedData.phase,
        hasContent: {
          requirements: !!migratedData.requirements,
          design: !!migratedData.design,
          tasks: !!migratedData.tasks
        },
        timing: migratedData.timing,
        apiResponses: migratedData.apiResponses
      })
      
      return true
    }
  })

  // Refinement history
  const [refinementHistory, setRefinementHistory] = useState<RefinementHistory[]>([])
  
  // Track previous phase for callbacks
  const previousPhaseRef = useRef<WorkflowPhase>(state.phase)

  // Phase progression logic
  const phases: WorkflowPhase[] = ['requirements', 'design', 'tasks', 'complete']
  const currentPhaseIndex = phases.indexOf(state.phase)
  
  const nextPhase: WorkflowPhase | null = 
    currentPhaseIndex < phases.length - 1 ? phases[currentPhaseIndex + 1] : null
  
  const previousPhase: WorkflowPhase | null = 
    currentPhaseIndex > 0 ? phases[currentPhaseIndex - 1] : null

  const canProceedToNext = Boolean(
    nextPhase && 
    state.approvals[state.phase as keyof ApprovalState] &&
    !state.isGenerating
  )

  const canGoBack = Boolean(previousPhase && !state.isGenerating)

  // Basic setters
  const setFeatureName = useCallback((name: string) => {
    setState(prev => ({ ...prev, featureName: name.trim() }))
  }, [setState, state.featureName])

  const setDescription = useCallback((description: string) => {
    setState(prev => ({ ...prev, description }))
  }, [setState, state.description])

  // Context file management
  const addContextFile = useCallback((file: ContextFile) => {
    setState(prev => ({
      ...prev,
      context: [...prev.context.filter(f => f.id !== file.id), file]
    }))
  }, [setState, state.context.length])

  const removeContextFile = useCallback((fileId: string) => {
    setState(prev => ({
      ...prev,
      context: prev.context.filter(f => f.id !== fileId)
    }))
  }, [setState])

  const clearContext = useCallback(() => {
    setState(prev => ({ ...prev, context: [] }))
  }, [setState, state.context.length])

  // Content management
  const updatePhaseContent = useCallback((phase: WorkflowPhase, content: string) => {
    if (phase === 'complete') return
    
    setState(prev => ({
      ...prev,
      [phase]: content
    }))
  }, [setState])

  const getPhaseContent = useCallback((phase: WorkflowPhase): string => {
    if (phase === 'complete') return ''
    return state[phase] || ''
  }, [state])

  // Generation logic
  const generateCurrentPhase = useCallback(async () => {
    if (!hasValidKey || !apiKey) {
      const error = new Error('Valid OpenRouter API key is required')
      setState(prev => ({ ...prev, error: error.message }))
      onError?.(error, state.phase)
      return
    }

    if (state.phase === 'complete') return

    const startTime = Date.now()
    setState(prev => ({ 
      ...prev, 
      isGenerating: true, 
      error: null,
      timing: {
        ...prev.timing,
        [state.phase]: {
          startTime,
          endTime: 0,
          elapsed: 0
        }
      }
    }))

    onGenerationStart?.(state.phase)

    try {
      // Build the appropriate prompt based on phase
      const systemPrompt = getSystemPromptForPhase(state.phase)
      const userPrompt = buildUserPrompt(state)

      // Basic validation in development
      if (process.env.NODE_ENV === 'development' && !userPrompt) {
        console.warn('Warning: Empty user prompt for generation')
      }

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          apiKey,
          model: selectedModel?.id || 'anthropic/claude-3.5-sonnet', // Use selected model or default
          systemPrompt,
          userPrompt,
          // contextFiles are already embedded in userPrompt by buildUserPrompt()
          contextFiles: [],
          options: {
            temperature: 0.3,
            max_tokens: 8192
          }
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error?.message || 'Generation failed')
      }

      const { content, usage, model } = await response.json()
      const endTime = Date.now()
      const elapsed = endTime - startTime

      // Calculate cost if usage data is available
      let costInfo = undefined
      if (usage && selectedModel?.pricing) {
        const promptPrice = parseFloat(selectedModel.pricing.prompt)
        const completionPrice = parseFloat(selectedModel.pricing.completion)
        
        const promptCost = usage.prompt_tokens * promptPrice
        const completionCost = usage.completion_tokens * completionPrice
        const totalCost = promptCost + completionCost
        
        costInfo = {
          prompt: promptCost,
          completion: completionCost,
          total: totalCost
        }
        
        console.log(`💰 [${state.phase}] Cost: $${totalCost.toFixed(4)} (${usage.prompt_tokens}p + ${usage.completion_tokens}c tokens)`);
      }

      setState(prev => ({
        ...prev,
        [state.phase]: content,
        isGenerating: false,
        error: null,
        timing: {
          ...prev.timing,
          [state.phase]: {
            startTime,
            endTime,
            elapsed
          }
        },
        apiResponses: {
          ...prev.apiResponses,
          [state.phase]: {
            model: model || selectedModel?.id || 'unknown',
            tokens: usage ? {
              prompt: usage.prompt_tokens || 0,
              completion: usage.completion_tokens || 0,
              total: usage.total_tokens || 0
            } : { prompt: 0, completion: 0, total: 0 },
            cost: costInfo,
            duration: elapsed,
            timestamp: endTime
          }
        }
      }))

      console.log(`[GenerateCurrentPhase] Completed ${state.phase}: ${elapsed}ms, tokens: ${usage?.total_tokens || 0}`)
      onGenerationComplete?.(state.phase, content)

    } catch (error) {
      const err = error instanceof Error ? error : new Error('Unknown error')
      const endTime = Date.now()
      const elapsed = endTime - startTime
      
      setState(prev => ({
        ...prev,
        isGenerating: false,
        error: err.message,
        timing: {
          ...prev.timing,
          [state.phase]: {
            startTime,
            endTime,
            elapsed
          }
        }
      }))
      onError?.(err, state.phase)
    }
  }, [hasValidKey, apiKey, state, setState, onGenerationStart, onGenerationComplete, onError, selectedModel])

  // Phase-specific generation matching Kiro IDE's workflow
  const generateWithData = useCallback(async (featureName: string, description: string, contextFiles: ContextFile[]) => {
    if (!hasValidKey || !apiKey) {
      const error = new Error('Valid OpenRouter API key is required')
      setState(prev => ({ ...prev, error: error.message }))
      onError?.(error, state.phase)
      return
    }

    if (state.phase === 'complete') {
      const error = new Error('Workflow is already complete')
      setState(prev => ({ ...prev, error: error.message }))
      onError?.(error, state.phase)
      return
    }

    // Track the actual start time for this generation
    const generationStartTime = Date.now()
    
    // SMART PROMPT CHANGE DETECTION: Auto-reset if prompt significantly changed
    const hasExistingContent = state.requirements || state.design || state.tasks
    if (hasExistingContent && state.phase === 'requirements') {
      const promptChanged = hasPromptChanged(
        state.description || '', 
        description, 
        state.featureName || '', 
        featureName
      )
      
      if (promptChanged) {
        // Auto-reset due to significant prompt change
        setState(prev => ({
          ...DEFAULT_SPEC_STATE,
          phase: 'requirements', // Start fresh at requirements phase
          featureName,
          description,
          context: contextFiles,
          isGenerating: true, // We're about to generate
          error: null,
          timing: {
            ...DEFAULT_SPEC_STATE.timing,
            [state.phase]: {
              startTime: generationStartTime,
              endTime: 0,
              elapsed: 0
            }
          }
        }))
        setRefinementHistory([])
        // Continue with generation using the clean state
      } else {
        setState(prev => ({ 
          ...prev, 
          isGenerating: true, 
          error: null,
          timing: {
            ...prev.timing,
            [state.phase]: {
              startTime: generationStartTime,
              endTime: 0,
              elapsed: 0
            }
          }
        }))
      }
    } else {
      setState(prev => ({ 
        ...prev, 
        isGenerating: true, 
        error: null,
        timing: {
          ...prev.timing,
          [state.phase]: {
            startTime: generationStartTime,
            endTime: 0,
            elapsed: 0
          }
        }
      }))
    }

    onGenerationStart?.(state.phase)

    try {
      const systemPrompt = getSystemPromptForPhase(state.phase)
      let userPrompt: string
      
      // Build phase-specific prompts (clean separation like Kiro IDE)
      switch (state.phase) {
        case 'requirements':
          // Requirements phase: Only use original input + context files with size limits
          const maxDescriptionLength = 5000 // ~1250 tokens max for description
          const truncatedDescription = description.length > maxDescriptionLength
            ? description.substring(0, maxDescriptionLength) + '\n\n[Description truncated to fit token limits]'
            : description
          
          // Requirements generation with size limits
          
          // Filter and truncate context BEFORE calling buildRequirementsPrompt
          const maxFileSize = 2000 // Max 2KB per file (~500 tokens)
          const maxTotalSize = 5000 // Max 5KB total (~1250 tokens)
          
          let totalSize = 0
          const contextToSend = contextFiles
            .filter(file => {
              // Skip images completely using robust detection
              if (isImageLike(file)) return false
              
              const fileSize = file.content?.length || 0
              
              // Skip files that are too large individually
              if (fileSize > maxFileSize) return false
              
              // Skip files that would exceed total size limit
              if (totalSize + fileSize > maxTotalSize) return false
              
              totalSize += fileSize
              return true
            })
            .map(file => {
              // Truncate content to be extra safe
              const truncatedContent = file.content && file.content.length > maxFileSize
                ? file.content.substring(0, maxFileSize) + '\n\n[File truncated due to size limits]'
                : file.content
                
              return {
                ...file,
                content: truncatedContent
              }
            })
          
          userPrompt = buildRequirementsPrompt(featureName, truncatedDescription, contextToSend)
          break
          
        case 'design':
          // Design phase: Only use approved requirements (no original description/files)
          if (!state.requirements) {
            throw new Error('Requirements must be completed and approved before generating design')
          }
          userPrompt = buildDesignPrompt(state.requirements)
          break
          
        case 'tasks':
          // Tasks phase: Only use approved requirements + design
          if (!state.requirements || !state.design) {
            throw new Error('Requirements and Design must be completed and approved before generating tasks')
          }
          userPrompt = buildTasksPrompt(state.requirements, state.design)
          break
          
        case 'complete':
          // Generation should not be called when workflow is complete
          throw new Error('Workflow is already complete. Cannot generate additional content.')
          
        default:
          throw new Error(`Unknown phase: ${state.phase}`)
      }

      // Validate token limits with new standardized method
      const tokenValidation = validateTokenLimits(systemPrompt, userPrompt, 8192, 200000)
      
      // Token validation for current phase
      
      // Token validation - fail fast if limits exceeded
      if (!tokenValidation.valid) {
        throw new Error(tokenValidation.error || `Phase ${state.phase} content exceeds token limit.`)
      }

      // Get context files to send based on phase (already filtered during prompt building)
      let contextToSend: ContextFile[] = []
      if (state.phase === 'requirements') {
        // Use the already filtered contextToSend from the requirements generation above
        // No additional filtering needed here since it was done in the switch statement
        contextToSend = [] // Empty since context is embedded in userPrompt already
        
        // Context embedded in userPrompt to prevent duplication
      }
      // Design and Tasks phases don't need context files - they use approved content
      
      // Sending to API with token-validated prompts
      
      // Content prepared for API call
      
      // Create a timeout for the API request (3 minutes)
      const controller = new AbortController()
      const timeoutId = setTimeout(() => {
        controller.abort()
      }, 180000) // 3 minutes

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          apiKey,
          model: selectedModel?.id || 'meta-llama/llama-3.2-3b-instruct:free',
          systemPrompt,
          userPrompt,
          // contextFiles are already embedded in userPrompt, don't send separately
          contextFiles: [],
          options: {
            temperature: 0.3,
            max_tokens: 8192
          }
        }),
        signal: controller.signal
      })

      // Clear the timeout since we got a response
      clearTimeout(timeoutId)

      // API response received

      if (!response.ok) {
        const errorText = await response.text()
        let errorData
        try {
          errorData = JSON.parse(errorText)
        } catch {
          errorData = { error: { message: errorText } }
        }
        throw new Error(errorData.error?.message || `API Error: ${response.status} ${response.statusText}`)
      }

      const responseText = await response.text()
      
      let responseData
      try {
        responseData = JSON.parse(responseText)
      } catch (error) {
        throw new Error('Invalid JSON response from API')
      }
      
      const { content, usage, model } = responseData
      const endTime = Date.now()
      // Calculate elapsed time using the startTime we captured at the beginning
      const elapsed = endTime - generationStartTime
      
      console.log(`[GenerateWithData] Phase ${state.phase} completed:`, {
        startTime: generationStartTime,
        endTime,
        elapsed,
        tokens: usage?.total_tokens || 0
      })

      // Calculate cost if usage data is available
      let costInfo = undefined
      if (usage && selectedModel?.pricing) {
        const promptPrice = parseFloat(selectedModel.pricing.prompt)
        const completionPrice = parseFloat(selectedModel.pricing.completion)
        
        const promptCost = usage.prompt_tokens * promptPrice
        const completionCost = usage.completion_tokens * completionPrice
        const totalCost = promptCost + completionCost
        
        costInfo = {
          prompt: promptCost,
          completion: completionCost,
          total: totalCost
        }
        
        console.log(`💰 [${state.phase}] Cost: $${totalCost.toFixed(4)} (${usage.prompt_tokens}p + ${usage.completion_tokens}c tokens)`);
      }

      // Update state appropriately for each phase
      setState(prev => {
        const baseUpdate = {
          ...prev,
          [state.phase]: content,
          isGenerating: false,
          error: null,
          timing: {
            ...prev.timing,
            // Only update timing for non-complete phases
            ...(state.phase !== 'complete' && {
              [state.phase]: {
                startTime: generationStartTime,
                endTime,
                elapsed
              }
            })
          },
          apiResponses: {
            ...prev.apiResponses,
            // Only update API responses for non-complete phases
            ...(state.phase !== 'complete' && {
              [state.phase]: {
                model: model || selectedModel?.id || 'unknown',
                tokens: usage ? {
                  prompt: usage.prompt_tokens || 0,
                  completion: usage.completion_tokens || 0,
                  total: usage.total_tokens || 0
                } : { prompt: 0, completion: 0, total: 0 },
                cost: costInfo,
                duration: elapsed,
                timestamp: endTime
              }
            })
          }
        }
        
        // Only update feature metadata during requirements phase
        if (state.phase === 'requirements') {
          return {
            ...baseUpdate,
            featureName,
            description,
            context: contextFiles
          }
        }
        
        // Design and Tasks phases don't need to update original input data
        return baseUpdate
      })

      onGenerationComplete?.(state.phase, content)

    } catch (error) {
      let errorMessage = 'Unknown error'
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          errorMessage = 'Request timed out after 3 minutes. Please try again with a shorter prompt or simpler requirements.'
        } else {
          errorMessage = error.message
        }
      }
      
      const err = new Error(errorMessage)
      const endTime = Date.now()
      const elapsed = endTime - generationStartTime
      
      setState(prev => ({
        ...prev,
        isGenerating: false,
        error: err.message,
        [state.phase]: '',
        timing: {
          ...prev.timing,
          [state.phase]: {
            startTime: generationStartTime,
            endTime,
            elapsed
          }
        }
      }))
      onError?.(err, state.phase)
    }
  }, [hasValidKey, apiKey, state, setState, onGenerationStart, onGenerationComplete, onError, selectedModel])

  // Refinement logic
  const refineCurrentPhase = useCallback(async (feedback: string) => {
    if (!hasValidKey || !apiKey) {
      const error = new Error('Valid OpenRouter API key is required')
      onError?.(error, state.phase)
      return
    }

    if (state.phase === 'complete') return

    const currentContent = getPhaseContent(state.phase)
    if (!currentContent.trim()) {
      const error = new Error('No content to refine. Generate initial content first.')
      onError?.(error, state.phase)
      return
    }

    setState(prev => ({ 
      ...prev, 
      isGenerating: true, 
      error: null 
    }))

    // Add to refinement history
    const refinementRequest: RefinementRequest = {
      phase: state.phase,
      currentContent,
      feedback,
      timestamp: Date.now()
    }

    try {
      const systemPrompt = getRefinementPromptForPhase(state.phase)
      const userPrompt = `
Current ${state.phase} content:
${currentContent}

User feedback: ${feedback}

Please update the ${state.phase} document based on this feedback while maintaining the overall structure and format.
      `.trim()

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          apiKey,
          model: selectedModel?.id || 'meta-llama/llama-3.2-3b-instruct:free',
          systemPrompt,
          userPrompt,
          // contextFiles not needed for refinement
          contextFiles: [],
          options: {
            temperature: 0.3,
            max_tokens: 8192
          }
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error?.message || 'Refinement failed')
      }

      const { content } = await response.json()

      setState(prev => ({
        ...prev,
        [state.phase]: content,
        isGenerating: false,
        error: null
      }))

      // Update refinement history
      setRefinementHistory(prev => {
        const phaseHistory = prev.find(h => h.phase === state.phase)
        
        if (phaseHistory) {
          return prev.map(h => 
            h.phase === state.phase 
              ? {
                  ...h,
                  versions: [...h.versions, {
                    content,
                    timestamp: Date.now(),
                    feedback
                  }]
                }
              : h
          )
        } else {
          return [...prev, {
            phase: state.phase,
            versions: [{
              content,
              timestamp: Date.now(),
              feedback
            }]
          }]
        }
      })

      onGenerationComplete?.(state.phase, content)

    } catch (error) {
      const err = error instanceof Error ? error : new Error('Unknown error')
      setState(prev => ({
        ...prev,
        isGenerating: false,
        error: err.message
      }))
      onError?.(err, state.phase)
    }
  }, [hasValidKey, apiKey, state, setState, getPhaseContent, onGenerationComplete, onError])

  // Approval and progression
  const approveCurrentPhase = useCallback(() => {
    if (state.phase === 'complete') return

    setState(prev => ({
      ...prev,
      approvals: {
        ...prev.approvals,
        [state.phase]: true
      }
    }))
  }, [state.phase, setState])

  const rejectCurrentPhase = useCallback(() => {
    if (state.phase === 'complete') return

    setState(prev => ({
      ...prev,
      approvals: {
        ...prev.approvals,
        [state.phase]: false
      }
    }))
  }, [state.phase, setState])

  const proceedToNextPhase = useCallback(() => {
    if (!canProceedToNext || !nextPhase) return

    const oldPhase = state.phase
    setState(prev => ({ ...prev, phase: nextPhase }))
    onPhaseChange?.(nextPhase, oldPhase)
  }, [canProceedToNext, nextPhase, state.phase, setState, onPhaseChange])

  // NEW: Atomic approve and proceed operation with automatic next phase generation
  const approveAndProceed = useCallback(async () => {
    if (state.phase === 'complete' || !nextPhase) return

    const oldPhase = state.phase
    const startTime = Date.now()
    
    // Immediately approve current phase, proceed to next, and set generating state
    console.log(`[ApproveAndProceed] Transitioning from ${state.phase} to ${nextPhase}`)
    
    setState(prev => ({
      ...prev,
      approvals: {
        ...prev.approvals,
        [state.phase]: true
      },
      phase: nextPhase,
      // Immediately set generating state to prevent UI flickering
      isGenerating: nextPhase !== 'complete',
      error: null,
      timing: {
        ...prev.timing,
        // Only update timing for non-complete phases
        ...(nextPhase !== 'complete' && {
          [nextPhase]: {
            startTime: startTime,
            endTime: 0,
            elapsed: 0
          }
        })
      }
    }))
    
    onPhaseChange?.(nextPhase, oldPhase)
    
    // Only proceed with generation if not complete
    if (nextPhase === 'complete') {
      return
    }
    
    onGenerationStart?.(nextPhase)
    
    try {
      // Build the appropriate prompt for the next phase
      const systemPrompt = getSystemPromptForPhase(nextPhase)
      const userPrompt = buildUserPrompt({ 
        ...state, 
        phase: nextPhase,
        approvals: {
          ...state.approvals,
          [state.phase]: true
        }
      })
      
      // Create AbortController for timeout handling
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 180000) // 3 minutes
      
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: controller.signal,
        body: JSON.stringify({
          apiKey,
          model: selectedModel?.id || 'anthropic/claude-3.5-sonnet',
          systemPrompt,
          userPrompt,
          contextFiles: [],
          options: {
            temperature: 0.3,
            max_tokens: 8192
          }
        })
      })
      
      clearTimeout(timeoutId)
      
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error?.message || 'Generation failed')
      }
      
      const { content, usage, model } = await response.json()
      
      // Calculate timing and cost info
      const endTime = Date.now()
      const elapsed = endTime - startTime
      
      // Calculate cost using the same logic as generateWithData
      let costInfo = undefined
      if (usage && selectedModel?.pricing) {
        const promptPrice = parseFloat(selectedModel.pricing.prompt)
        const completionPrice = parseFloat(selectedModel.pricing.completion)
        
        const promptCost = usage.prompt_tokens * promptPrice
        const completionCost = usage.completion_tokens * completionPrice
        const totalCost = promptCost + completionCost
        
        costInfo = {
          prompt: promptCost,
          completion: completionCost,
          total: totalCost
        }
        
        console.log(`💰 [${nextPhase}] Cost: $${totalCost.toFixed(4)} (${usage.prompt_tokens}p + ${usage.completion_tokens}c tokens)`);
      }
      
      console.log(`[ApproveAndProceed] Generation completed for ${nextPhase}, content length: ${content?.length || 0}`)
      
      setState(prev => ({
        ...prev,
        [nextPhase]: content,
        isGenerating: false,
        error: null,
        timing: {
          ...prev.timing,
          // Only update timing for non-complete phases
          ...(nextPhase !== 'complete' && {
            [nextPhase]: {
              startTime,
              endTime,
              elapsed
            }
          })
        },
        apiResponses: {
          ...prev.apiResponses,
          // Only update API responses for non-complete phases
          ...(nextPhase !== 'complete' && {
            [nextPhase]: {
              model: model || selectedModel?.id || 'unknown',
              tokens: usage ? {
                prompt: usage.prompt_tokens || 0,
                completion: usage.completion_tokens || 0,
                total: usage.total_tokens || 0
              } : { prompt: 0, completion: 0, total: 0 },
              cost: costInfo,
              duration: elapsed,
              timestamp: endTime
            }
          })
        }
      }))
      
      onGenerationComplete?.(nextPhase, content)
      
    } catch (error) {
      let errorMessage = 'Unknown error'
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          errorMessage = 'Request timed out after 3 minutes. Please try again with a shorter prompt or simpler requirements.'
        } else {
          errorMessage = error.message
        }
      }
      
      const err = new Error(errorMessage)
      console.error(`[ApproveAndProceed] Error in ${nextPhase}:`, err.message)
      
      setState(prev => ({
        ...prev,
        isGenerating: false,
        error: err.message,
        // CRITICAL: Do NOT reset phase on error - stay on current phase
        // phase: prev.phase (keep current phase, don't revert)
      }))
      onError?.(err, nextPhase)
    }
  }, [state, nextPhase, setState, onPhaseChange, onGenerationStart, onGenerationComplete, onError, apiKey, selectedModel, hasValidKey])

  const goToPreviousPhase = useCallback(() => {
    if (!canGoBack || !previousPhase) return

    const oldPhase = state.phase
    setState(prev => ({ ...prev, phase: previousPhase }))
    onPhaseChange?.(previousPhase, oldPhase)
  }, [canGoBack, previousPhase, state.phase, setState, onPhaseChange])

  // Utility functions - AGGRESSIVE RESET
  const reset = useCallback(() => {
    // Step 1: Reset state to default
    setState(DEFAULT_SPEC_STATE)
    setRefinementHistory([])
    
    // Step 2: Force localStorage removal
    if (typeof window !== 'undefined') {
      localStorage.removeItem('openspec-workflow-state')
      sessionStorage.removeItem('openspec-workflow-state')
      
      // Remove any other OpenSpec related keys
      const keysToRemove = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.includes('openspec')) {
          keysToRemove.push(key)
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key))
      
      // Also clear from sessionStorage
      const sessionKeysToRemove = []
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i)
        if (key && key.includes('openspec')) {
          sessionKeysToRemove.push(key)
        }
      }
      sessionKeysToRemove.forEach(key => sessionStorage.removeItem(key))
    }
    
    // Step 3: Force sync after delay
    setTimeout(() => forceSync(), 100)
  }, [setState, forceSync, state])

  // NEW: Selective reset - preserves API key and model settings
  const resetProjectOnly = useCallback(() => {
    console.log('[ResetProjectOnly] Clearing project data while preserving authentication and model settings')
    
    // Step 1: Reset workflow state to default (but don't touch API keys/models)
    setState(DEFAULT_SPEC_STATE)
    setRefinementHistory([])
    
    // Step 2: Clear only project-specific localStorage data
    if (typeof window !== 'undefined') {
      localStorage.removeItem('openspec-workflow-state')
      // Note: We deliberately DON'T clear sessionStorage items like:
      // - openspec-api-key
      // - openspec-api-key-tested  
      // - openspec-selected-model
    }
    
    // Step 3: Force sync after delay
    setTimeout(() => forceSync(), 100)
    
    console.log('[ResetProjectOnly] Project reset complete - API key and model selection preserved')
  }, [setState, forceSync])

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }))
  }, [setState])

  // Additional methods for test compatibility
  const generateContent = useCallback(async (phase: WorkflowPhase, prompt: string, model: string) => {
    // Use direct generation approach instead of state-dependent method
    // Extract feature name from prompt or use default
    const promptLines = prompt.trim().split('\n')
    const featureName = promptLines[0]?.replace(/^#+\s*/, '').trim() || 'Technical Specification'
    
    // Use current context files from state
    const contextFiles = state.context || []
    
    // Temporarily switch to target phase if needed
    const currentPhase = state.phase
    if (phase !== currentPhase) {
      setState(prev => ({ ...prev, phase }))
    }
    
    try {
      await generateWithData(featureName, prompt, contextFiles)
    } finally {
      // Restore original phase if it was changed
      if (phase !== currentPhase) {
        setState(prev => ({ ...prev, phase: currentPhase }))
      }
    }
  }, [state.phase, state.context, setState, generateWithData])

  const refineContent = useCallback(async (phase: WorkflowPhase, feedback: string, model: string) => {
    // Use refinement method which is separate from generation
    // Temporarily switch to target phase if needed
    const currentPhase = state.phase
    if (phase !== currentPhase) {
      setState(prev => ({ ...prev, phase }))
    }
    
    try {
      await refineCurrentPhase(feedback)
    } finally {
      // Restore original phase if it was changed
      if (phase !== currentPhase) {
        setState(prev => ({ ...prev, phase: currentPhase }))
      }
    }
  }, [state.phase, setState, refineCurrentPhase])

  const setCurrentPhase = useCallback((phase: WorkflowPhase) => {
    setState(prev => ({ ...prev, phase }))
  }, [setState])

  const updateApproval = useCallback((phase: WorkflowPhase, status: 'approved' | 'pending') => {
    setState(prev => ({
      ...prev,
      approvals: {
        ...prev.approvals,
        [phase]: status === 'approved'
      }
    }))
  }, [setState])

  const progressToNextPhase = useCallback(() => {
    proceedToNextPhase()
  }, [proceedToNextPhase])

  const resetWorkflow = useCallback(() => {
    reset()
  }, [reset])

  const setError = useCallback((message: string) => {
    setState(prev => ({ ...prev, error: message }))
  }, [setState])

  const canProgressToNextPhase = useCallback(() => {
    return canProceedToNext
  }, [canProceedToNext])

  const isWorkflowComplete = useCallback(() => {
    return state.approvals.requirements && state.approvals.design && state.approvals.tasks
  }, [state.approvals])

  // Helper getters for test compatibility
  const phaseContent = {
    requirements: state.requirements || '',
    design: state.design || '',
    tasks: state.tasks || ''
  }

  const approvals = {
    requirements: state.approvals.requirements ? 'approved' as const : 'pending' as const,
    design: state.approvals.design ? 'approved' as const : 'pending' as const,
    tasks: state.approvals.tasks ? 'approved' as const : 'pending' as const
  }

  const exportData = useCallback(() => {
    return {
      state,
      refinementHistory,
      exportedAt: new Date().toISOString(),
      version: '1.0'
    }
  }, [state, refinementHistory])

  const importData = useCallback((data: any): boolean => {
    try {
      if (data && data.state && typeof data.state === 'object') {
        setState(data.state)
        if (data.refinementHistory && Array.isArray(data.refinementHistory)) {
          setRefinementHistory(data.refinementHistory)
        }
        return true
      }
      return false
    } catch (error) {
      console.error('Failed to import data:', error)
      return false
    }
  }, [setState])

  // Track phase changes
  useEffect(() => {
    if (previousPhaseRef.current !== state.phase) {
      onPhaseChange?.(state.phase, previousPhaseRef.current)
      previousPhaseRef.current = state.phase
    }
  }, [state.phase, onPhaseChange])

  // CRITICAL: Auto-correct corrupted workflow state
  useEffect(() => {
    // If we have requirements content but are still on requirements phase, force progress
    if (state.requirements && state.requirements.trim().length > 0 && state.phase === 'requirements' && state.approvals.requirements) {
      console.warn('[StateCorruption] Auto-correcting: requirements exist and approved but still on requirements phase')
      setState(prev => ({ ...prev, phase: 'design' }))
    }
    // If we have design content but are on requirements phase, force progress  
    if (state.design && state.design.trim().length > 0 && state.phase === 'requirements') {
      console.warn('[StateCorruption] Auto-correcting: design exists but on requirements phase')
      setState(prev => ({ ...prev, phase: 'design', approvals: { ...prev.approvals, requirements: true } }))
    }
    // If we have tasks content but are on requirements/design phase, force progress
    if (state.tasks && state.tasks.trim().length > 0 && (state.phase === 'requirements' || state.phase === 'design')) {
      console.warn('[StateCorruption] Auto-correcting: tasks exist but not on tasks phase')
      setState(prev => ({ 
        ...prev, 
        phase: 'tasks',
        approvals: { ...prev.approvals, requirements: true, design: true }
      }))
    }
  }, [state.requirements, state.design, state.tasks, state.phase, state.approvals, setState])

  return {
    // State
    state,
    refinementHistory,
    
    // Phase management
    currentPhase: state.phase,
    canProceedToNext,
    canGoBack,
    nextPhase,
    previousPhase,
    
    // Basic actions
    setFeatureName,
    setDescription,
    addContextFile,
    removeContextFile,
    clearContext,
    
    // Generation actions
    generateCurrentPhase,
    generateWithData,
    refineCurrentPhase,
    
    // Approval and progression
    approveCurrentPhase,
    rejectCurrentPhase,
    proceedToNextPhase,
    approveAndProceed,
    goToPreviousPhase,
    
    // Content management
    updatePhaseContent,
    getPhaseContent,
    
    // Utility actions
    reset,
    resetProjectOnly,
    clearError,
    exportData,
    importData,
    forceSync,
    
    // Test-compatible API aliases and additional methods
    generateContent,
    refineContent,
    setCurrentPhase,
    updateApproval,
    progressToNextPhase,
    resetWorkflow,
    setError,
    canProgressToNextPhase,
    isWorkflowComplete,
    
    // Test-compatible properties
    isGenerating: state.isGenerating,
    error: state.error,
    phaseContent,
    approvals
  }
}

// Helper functions for prompts  
function getSystemPromptForPhase(phase: WorkflowPhase): string {
  // Get current date from browser
  const currentDate = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  const dateContext = ` Current Date: ${currentDate}. Use this date when referencing timeframes, planning, or scheduling in your response.`;
  
  switch (phase) {
    case 'requirements':
      return `You are creating a requirements document in EARS format based on the provided feature description. Generate an initial requirements document following the structure with clear user stories and EARS acceptance criteria using WHEN, IF, WHILE, WHERE keywords.${dateContext}`
    case 'design':
      return `You are creating a comprehensive design document based on approved requirements. Include technical architecture, components, data models, error handling, and testing strategy. Use Mermaid diagrams for complex relationships.${dateContext}`
    case 'tasks':
      return `You are creating an actionable implementation plan based on approved design. Convert the design into discrete, manageable coding tasks with numbered checkboxes, specific deliverables, and requirement references.${dateContext}`
    default:
      return `You are creating technical specifications following standard formats.${dateContext}`
  }
}

function getRefinementPromptForPhase(phase: WorkflowPhase): string {
  switch (phase) {
    case 'requirements':
      return 'You are refining existing requirements based on feedback while maintaining EARS format and structure.'
    case 'design':
      return 'You are refining existing design documents based on feedback while maintaining technical completeness and valid Mermaid diagrams.'
    case 'tasks':
      return 'You are refining implementation tasks based on feedback while maintaining the numbered checkbox format and requirement traceability.'
    default:
      return 'You are refining technical content based on feedback.'
  }
}

// Phase-specific prompt builders matching Kiro IDE's approach
function buildRequirementsPrompt(featureName: string, description: string, contextFiles: ContextFile[]): string {
  // Get current date from browser
  const currentDate = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  let prompt = `Feature: ${featureName}

Current Date: ${currentDate}

Description:
${description}`

  // Only add context files if they exist and are small enough
  if (contextFiles.length > 0) {
    prompt += '\n\nContext Files:\n'
    
    // Calculate current prompt size to ensure we don't exceed limits
    const currentSize = prompt.length
    const maxTotalPromptSize = 12000 // ~3200 tokens total for entire prompt (more realistic)
    let remainingSpace = maxTotalPromptSize - currentSize
    
    contextFiles.forEach(file => {
        // Skip if no space remaining
        if (remainingSpace <= 100) return
      
      if (file.type === 'image/png' || file.type === 'image/jpeg' || file.type?.startsWith('image/')) {
        // For images, just mention them but don't include the content
        const imageRef = `\n## ${file.name} (Image File):\nImage file (${file.type}) providing visual context.\n`
        if (imageRef.length <= remainingSpace) {
          prompt += imageRef
          remainingSpace -= imageRef.length
        }
      } else if (file.type !== 'image') {
        // For text files, include content with strict limits
        const content = file.content?.toString() || ''
        const maxContentForThisFile = Math.min(1000, remainingSpace - 100) // Leave buffer
        
        if (maxContentForThisFile > 0) {
          const truncatedContent = content.length > maxContentForThisFile 
            ? content.substring(0, maxContentForThisFile) + '\n[Truncated]'
            : content
          const fileSection = `\n## ${file.name}:\n${truncatedContent}\n`
          
          if (fileSection.length <= remainingSpace) {
            prompt += fileSection
            remainingSpace -= fileSection.length
          }
        }
      }
    })
    
    // Requirements prompt built
  }

  return prompt
}

function buildDesignPrompt(requirements: string): string {
  // Get current date from browser
  const currentDate = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  return `Based on the following approved requirements, create a comprehensive technical design document with architectural diagrams.

Current Date: ${currentDate}

## Requirements:
${requirements}`
}

function buildTasksPrompt(requirements: string, design: string): string {
  // Get current date from browser
  const currentDate = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  return `Based on the following approved requirements and design, create a detailed implementation task list with numbered checkboxes.

Current Date: ${currentDate}

## Requirements:
${requirements}

## Design:
${design}`
}

// Standardized token estimation utility
function estimateTokens(text: string): number {
  // Based on OpenAI/Anthropic tokenization: ~3.7 chars per token for English
  return Math.ceil(text.length / 3.7)
}

function isImageLike(file: ContextFile): boolean {
  if (!file) return false
  
  // Check file type
  if (file.type && (file.type.startsWith('image/') || file.type === 'image/png' || file.type === 'image/jpeg')) {
    return true
  }
  
  // Check file name extensions
  if (file.name && /\.(jpg|jpeg|png|gif|svg|webp|bmp|ico)$/i.test(file.name)) {
    return true
  }
  
  // Check for data URLs (base64 images)
  if (file.content && typeof file.content === 'string' && file.content.startsWith('data:image/')) {
    return true
  }
  
  return false
}

function validateTokenLimits(systemPrompt: string, userPrompt: string, maxTokens = 8192, modelLimit = 200000): { 
  valid: boolean; 
  estimated: number; 
  breakdown: { system: number; user: number; output: number; total: number };
  error?: string;
} {
  const systemTokens = estimateTokens(systemPrompt)
  const userTokens = estimateTokens(userPrompt)
  const outputTokens = maxTokens
  const totalTokens = systemTokens + userTokens + outputTokens
  
  const breakdown = {
    system: systemTokens,
    user: userTokens,
    output: outputTokens,
    total: totalTokens
  }
  
  if (totalTokens > modelLimit) {
    return {
      valid: false,
      estimated: totalTokens,
      breakdown,
      error: `Total tokens (${totalTokens}) exceeds model limit (${modelLimit}). System: ${systemTokens}, User: ${userTokens}, Output: ${outputTokens}`
    }
  }
  
  return {
    valid: true,
    estimated: totalTokens,
    breakdown
  }
}

// Legacy function for backward compatibility - now routes to phase-specific builders
function buildUserPrompt(state: SpecState): string {
  switch (state.phase) {
    case 'requirements':
      return buildRequirementsPrompt(state.featureName, state.description, state.context)
    case 'design':
      return buildDesignPrompt(state.requirements || '')
    case 'tasks':
      return buildTasksPrompt(state.requirements || '', state.design || '')
    default:
      return buildRequirementsPrompt(state.featureName, state.description, state.context)
  }
}
