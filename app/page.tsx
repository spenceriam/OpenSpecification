'use client'

import { useState, useEffect } from 'react'
import ApiKeyInput from '@/components/ApiKeyInput'
import ModelSelector from '@/components/ModelSelector'
import PromptInput from '@/components/PromptInput'
import { ComponentErrorBoundary } from '@/components/ErrorBoundary'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertCircle, CheckCircle, FileText, Layers, List, MessageSquare, Play, Loader2, Download, Key, Brain, Check, X } from 'lucide-react'
import { useSpecWorkflow } from '@/hooks/useSpecWorkflow'
import { ElapsedTimer } from '@/components/ElapsedTimer'
import { createSpecificationZip, downloadZipFile } from '@/lib/exportUtils'
import { useSimpleApiKeyStorage } from '@/hooks/useSimpleApiKeyStorage'
import { useModelStorage, usePromptStorage, useContextFilesStorage } from '@/hooks/useSessionStorage'
import { DotPattern } from '@/components/magicui/dot-pattern'

export default function Home() {
  const { value: apiKey, hasValidKey, setAPIKey, clearAPIKey } = useSimpleApiKeyStorage()
  
  const { selectedModel, setModel, clearModel } = useModelStorage()
  const { prompt, setPrompt, clearPrompt } = usePromptStorage()
  const { contextFiles, setFiles: setContextFiles, clearFiles: clearContextFiles } = useContextFilesStorage()
  
  // Initialize the actual spec workflow
  const workflow = useSpecWorkflow({
    selectedModel,
  })
  const [currentStep, setCurrentStep] = useState(1)
  const [showContinueDialog, setShowContinueDialog] = useState(false)
  const [hasCheckedSession, setHasCheckedSession] = useState(false)
  const [apiKeyStatus, setApiKeyStatus] = useState<'loading' | 'success' | 'error' | null>(null)
  const [modelLoadStatus, setModelLoadStatus] = useState<'loading' | 'success' | 'error' | null>(null)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [lastGenerationTime, setLastGenerationTime] = useState<number>(0)
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false)
  const [contentCollapsed, setContentCollapsed] = useState(true) // Default to collapsed/preview mode
  const [justDidReset, setJustDidReset] = useState(false) // Track if we just did a reset
  const [expandedSpecs, setExpandedSpecs] = useState<{[key: string]: boolean}>({}) // Track expanded specifications
  const [showNewProjectNotification, setShowNewProjectNotification] = useState(false) // Track new project started

  const hasApiKey = Boolean(apiKey && hasValidKey)
  const hasModel = Boolean(selectedModel)
  const hasPrompt = prompt.trim().length > 10
  const canStartGeneration = hasApiKey && hasModel && hasPrompt
  
  // Helper function to check if current phase has content
  const hasContentForCurrentPhase = () => {
    switch (workflow.currentPhase) {
      case 'requirements':
        return workflow.state.requirements && workflow.state.requirements.trim().length > 0
      case 'design':
        return workflow.state.design && workflow.state.design.trim().length > 0
      case 'tasks':
        return workflow.state.tasks && workflow.state.tasks.trim().length > 0
      default:
        return false
    }
  }

  // Check for existing session data on mount - ONLY ONCE
  useEffect(() => {
    if (hasCheckedSession) return // Don't check again if we've already checked
    
    // Check if we just did a reset (flag in sessionStorage)
    const justReset = sessionStorage.getItem('openspec-just-reset')
    if (justReset) {
      // DON'T remove the flag immediately - let all hooks process it first
      // We'll remove it after a delay to ensure all storage hooks see it
      setJustDidReset(true)
      setHasCheckedSession(true)
      
      // Remove the flag after a short delay to let all hooks process it
      setTimeout(() => {
        sessionStorage.removeItem('openspec-just-reset')
      }, 1000)
      
      return // Skip session restoration after reset
    }
    
    // Don't auto-advance if we just did a reset
    if (justDidReset) {
      setHasCheckedSession(true)
      return
    }
    
    const hasPromptData = prompt.trim().length > 10 // Meaningful prompt content
    const hasFiles = contextFiles.length > 0
    // Only show dialog if user has made meaningful progress beyond just API key + model selection
    const hasMeaningfulProgress = (hasApiKey && hasModel && (hasPromptData || hasFiles))
    
    if (hasMeaningfulProgress) {
      setShowContinueDialog(true)
    }
    
    // Set initial step based on what's already completed
    // But don't change currentStep if workflow is actively running (requirements phase or beyond)
    if (workflow.currentPhase === 'complete') {
      // Always show step 4 when workflow is complete
      setCurrentStep(4)
    } else if (workflow.currentPhase !== 'requirements' || workflow.state.requirements) {
      // If we're past requirements phase or have generated requirements, keep at step 4
      setCurrentStep(4)
    } else if (!workflow.isGenerating) {
      // Only set initial steps if we haven't started the workflow yet
      if (hasApiKey && selectedModel && hasPromptData) {
        setCurrentStep(3)
        setApiKeyStatus('success')
        setModelLoadStatus('success')
      } else if (hasApiKey && selectedModel) {
        setCurrentStep(3)
        setApiKeyStatus('success')
        setModelLoadStatus('success')
      } else if (hasApiKey) {
        setCurrentStep(2)
        setApiKeyStatus('success')
      }
    }
    
    setHasCheckedSession(true) // Mark that we've checked the session
  }, [hasApiKey, selectedModel, prompt, contextFiles, hasCheckedSession, justDidReset])
  
  // CRITICAL: Prevent currentStep resets during active workflow generation
  useEffect(() => {
    // Once we have generated requirements, NEVER allow currentStep to go below 4
    if (workflow.state.requirements && workflow.state.requirements.trim().length > 0) {
      console.log('[StepLock] Locking currentStep at 4 - requirements exist')
      if (currentStep < 4) {
        setCurrentStep(4)
      }
    }
    // If workflow is generating, lock at step 4
    if (workflow.isGenerating && currentStep !== 4) {
      console.log('[StepLock] Locking currentStep at 4 - workflow is generating')
      setCurrentStep(4)
    }
    // If workflow phase is beyond requirements, lock at step 4
    if (workflow.currentPhase !== 'requirements' && currentStep !== 4) {
      console.log(`[StepLock] Locking currentStep at 4 - phase is ${workflow.currentPhase}`)
      setCurrentStep(4)
    }
  }, [workflow.state.requirements, workflow.isGenerating, workflow.currentPhase, currentStep])

  // Ensure API key status is set correctly when key is valid (but not after reset)
  useEffect(() => {
    if (hasApiKey && apiKeyStatus !== 'success' && !justDidReset) {
      setApiKeyStatus('success')
    }
  }, [hasApiKey, apiKeyStatus, justDidReset])

  // Ensure model load status is set correctly when model is selected
  useEffect(() => {
    if (hasModel && modelLoadStatus !== 'success') {
      setModelLoadStatus('success')
    }
  }, [hasModel, modelLoadStatus])

  const handleApiKeyValidated = (isValid: boolean, key?: string) => {
    if (isValid && key) {
      setApiKeyStatus('success')
      setCurrentStep(2)
      setJustDidReset(false) // Allow normal progression after API key entry
    } else {
      setApiKeyStatus('error')
      setCurrentStep(1) // Stay on step 1 if validation fails
    }
  }

  const handleModelSelected = (model: any) => {
    setModel(model)
    setModelLoadStatus('success')
    setCurrentStep(3)
  }

  const handleResetAndStartFresh = () => {
    
    // Step 1: Reset all UI state immediately
    setCurrentStep(1)
    setApiKeyStatus(null)
    setModelLoadStatus(null)
    setIsRegenerating(false)
    setLastGenerationTime(0)
    setShowRegenerateConfirm(false)
    setContentCollapsed(true)
    setHasCheckedSession(true) // Prevent session restore dialog
    setJustDidReset(true) // Prevent auto-advancement
    
    // Step 2: Reset workflow state aggressively - FORCE IMMEDIATE RESET
    workflow.resetWorkflow()
    workflow.reset() // Call both methods to ensure complete reset
    
    // Step 3: Clear API key, model, and prompt data
    clearAPIKey()
    clearModel()
    clearPrompt()
    clearContextFiles()
    
    // Step 4: Clear storage thoroughly
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem('openspec-just-reset', 'true')
        localStorage.removeItem('openspec-workflow-state')
        
        // Clear all openspec-related keys
        const localKeys = Object.keys(localStorage)
        localKeys.forEach(key => {
          if (key.includes('openspec')) {
            localStorage.removeItem(key)
          }
        })
        
        const sessionKeys = Object.keys(sessionStorage)
        sessionKeys.forEach(key => {
          if (key.includes('openspec') && key !== 'openspec-just-reset') {
            sessionStorage.removeItem(key)
          }
        })
        
        localStorage.clear()
        sessionStorage.setItem('openspec-just-reset', 'true')
      } catch (error) {
        console.error('Storage clear error:', error)
      }
    }
    // Force page reload to ensure completely clean state
    setTimeout(() => window.location.reload(), 200)
  }

  // NEW: Selective clearing - preserves API key and model selection
  const handleStartNewProject = () => {
    console.log('[StartNewProject] Starting new project while preserving user settings')
    
    // Step 1: Reset UI state but preserve authentication status
    setCurrentStep(3) // Go directly to Prompt screen (skip API key + model steps)
    // Keep apiKeyStatus and modelLoadStatus as 'success' since they're still valid
    setIsRegenerating(false)
    setLastGenerationTime(0)
    setShowRegenerateConfirm(false)
    setContentCollapsed(true)
    setHasCheckedSession(true) // Prevent session restore dialog
    setJustDidReset(false) // Allow normal progression since we're keeping settings
    setExpandedSpecs({}) // Reset expanded specifications
    
    // Step 2: Reset workflow state only (preserves API key and model in session)
    workflow.resetProjectOnly() // Use new selective reset method
    
    // Step 3: Clear only project-specific data (NOT API key or model)
    clearPrompt() // Clear prompt text
    clearContextFiles() // Clear uploaded files
    // Note: We deliberately DON'T call clearAPIKey() or clearModel()
    
    // Step 4: Set flag and show notification
    setShowNewProjectNotification(true)
    
    // Hide notification after 3 seconds
    setTimeout(() => {
      setShowNewProjectNotification(false)
    }, 3000)
    
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem('openspec-new-project-started', 'true')
        // Remove the flag after a short delay to let components process it
        setTimeout(() => {
          sessionStorage.removeItem('openspec-new-project-started')
        }, 1000)
      } catch (error) {
        console.error('Session storage error:', error)
      }
    }
    
    console.log('[StartNewProject] New project started - API key and model preserved')
  }

  const handleContinue = () => {
    setShowContinueDialog(false)
    setHasCheckedSession(true) // Mark as checked so dialog won't show again
    // Step is already set correctly in useEffect
  }

  const handleBackToPrompt = () => {
    // If generation has been used at least once, just go back and allow regeneration
    if (lastGenerationTime > 0) {
      setCurrentStep(3)
      setIsRegenerating(true)
      return
    }
    
    // Check if there's existing content that would be lost
    const hasExistingContent = workflow.phaseContent.requirements || 
                              workflow.phaseContent.design || 
                              workflow.phaseContent.tasks
    
    if (hasExistingContent) {
      setShowRegenerateConfirm(true)
    } else {
      // No content to lose, go back directly
      setCurrentStep(3)
      setIsRegenerating(false)
    }
  }

  const handleConfirmRegenerate = () => {
    // Clear existing workflow content
    workflow.resetWorkflow()
    setCurrentStep(3)
    setIsRegenerating(true)
    setShowRegenerateConfirm(false)
  }

  const handleCancelRegenerate = () => {
    setShowRegenerateConfirm(false)
  }

  const handleGenerate = async () => {
    
    // Gentle rate limiting: prevent rapid double-clicks (minimum 2 seconds between generations)
    const now = Date.now()
    const timeSinceLastGeneration = now - lastGenerationTime
    const minInterval = 2000 // 2 seconds
    
    if (timeSinceLastGeneration < minInterval && lastGenerationTime > 0) {
      return // Silently prevent rapid generation requests
    }
    
    setLastGenerationTime(now)
    setCurrentStep(4)
    
    // Extract feature name from prompt (first line or use default)
    const promptLines = prompt.trim().split('\n')
    const featureName = promptLines[0]?.replace(/^#+\s*/, '').trim() || 'Technical Specification'
    
    // Pass data directly to generation
    
    // Filter to text files only for generation context
    const textFiles = contextFiles.filter(file => 
      !file.type?.startsWith('image/') && 
      file.type !== 'image/png' && 
      file.type !== 'image/jpeg'
    )
    
    // Filter to text files for AI context
    
    const workflowContextFiles = textFiles.map(file => ({
      id: file.id,
      name: file.name,
      type: file.type as any,
      content: file.content,
      size: file.size,
      lastModified: file.lastModified || Date.now(),
      mimeType: file.mimeType || 'text/plain'
    }))
    
    // Start generation for the requirements phase with direct data
    try {
      await workflow.generateWithData(featureName, prompt, workflowContextFiles)
    } catch (error) {
      // Error handling is managed by the workflow hook
    }
  }

  // Export functionality moved inline

  // Handle step navigation - allow going back to previous steps
  const handleStepClick = (step: number) => {
    // Special handling for going back to Prompt from Generation step
    if (currentStep === 4 && step === 3) {
      handleBackToPrompt()
      return
    }
    
    // Only allow navigation to completed steps or the current step
    if (step <= currentStep || (step === 1) || 
        (step === 2 && hasApiKey) || 
        (step === 3 && hasApiKey && hasModel)) {
      setCurrentStep(step)
    }
  }

  // Check if step is clickable
  const isStepClickable = (step: number, completed: boolean) => {
    return step < currentStep || completed || 
           (step === 1) || 
           (step === 2 && hasApiKey) || 
           (step === 3 && hasApiKey && hasModel)
  }

  return (
    <div className="min-h-screen bg-background flex flex-col relative">
      {/* Subtle Dot Pattern Background */}
      <DotPattern 
        className="opacity-20 fill-muted-foreground/10" 
        width={32} 
        height={32} 
        cx={1} 
        cy={1} 
        cr={0.8}
      />
      
      {/* New Project Notification */}
      {showNewProjectNotification && (
        <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50">
          <div className="bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-in slide-in-from-top-2 duration-300">
            <CheckCircle className="h-5 w-5" />
            <span className="font-medium">New project started! Your API key and model selection have been preserved.</span>
          </div>
        </div>
      )}
      
      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex-1 relative z-10">
        {/* Compact Hero Section */}
        <div className="text-center mb-4">
          <h2 className="text-xl font-bold text-foreground mb-1">
            Generate Technical Specifications
          </h2>
          <p className="text-xs text-muted-foreground max-w-xl mx-auto">
            Create comprehensive requirements, design documents, and tasks using AI models.
          </p>
        </div>

        {/* Step Progress */}
        <div className="mb-3">
          <div className="flex items-center justify-center gap-8 mb-3">
            {[
              { step: 1, label: 'API Key', icon: Key, completed: hasApiKey },
              { step: 2, label: 'AI Model', icon: Brain, completed: hasModel },
              { step: 3, label: 'Prompt', icon: MessageSquare, completed: hasPrompt },
              { step: 4, label: 'Generate', icon: Play, completed: workflow.currentPhase === 'complete' }
            ].map(({ step, label, icon: Icon, completed }) => {
              const clickable = isStepClickable(step, completed)
              const isGenerateStep = step === 4
              const isReadyToGenerate = isGenerateStep && canStartGeneration
              
              // Determine status for each step
              let stepStatus: 'success' | 'error' | 'loading' | null = null
              if (step === 1) stepStatus = apiKeyStatus
              if (step === 2) stepStatus = modelLoadStatus
              if (step === 3 && hasPrompt) stepStatus = 'success'
              
              // Choose icon based on status
              let DisplayIcon = Icon
              if (stepStatus === 'success') DisplayIcon = Check
              if (stepStatus === 'error') DisplayIcon = X
              
              // Special handling for Generate step when complete
              if (isGenerateStep && workflow.currentPhase === 'complete') {
                DisplayIcon = Check
                stepStatus = 'success'
              }
              
              return (
                <div 
                  key={step} 
                  className={`flex flex-col items-center ${
                    clickable || isReadyToGenerate ? 'cursor-pointer group' : 'cursor-default'
                  }`}
                  onClick={() => {
                    if (isReadyToGenerate) {
                      handleGenerate()
                    } else if (clickable) {
                      handleStepClick(step)
                    }
                  }}
                >
                  <div className={`flex items-center justify-center w-8 h-8 rounded-full border-2 mb-2 transition-all duration-200 ${
                    stepStatus === 'success' 
                      ? 'bg-green-500 border-green-500 text-white' 
                      : stepStatus === 'error'
                        ? 'bg-red-500 border-red-500 text-white'
                        : stepStatus === 'loading'
                          ? 'bg-blue-500 border-blue-500 text-white animate-spin'
                          : currentStep === step 
                            ? 'border-primary text-primary bg-background'
                            : isReadyToGenerate
                              ? 'bg-blue-400 border-blue-400 text-white shadow-lg animate-pulse-slow'
                              : 'border-muted-foreground text-muted-foreground bg-background'
                  } ${
                    (clickable || isReadyToGenerate) ? 'group-hover:scale-110' : ''
                  } ${
                    isReadyToGenerate ? 'ring-2 ring-blue-200' : ''
                  }`}>
                    <DisplayIcon className="w-4 h-4" />
                  </div>
                  <p className={`text-xs font-medium ${
                    stepStatus === 'success' ? 'text-green-400' 
                      : stepStatus === 'error' ? 'text-red-400'
                        : currentStep >= step ? 'text-foreground' : 'text-muted-foreground'
                  } ${
                    isReadyToGenerate ? 'text-blue-400 font-bold' : ''
                  } ${
                    (clickable || isReadyToGenerate) ? 'group-hover:text-primary' : ''
                  }`}>{isReadyToGenerate ? 'Generate!' : label}</p>
                </div>
              )
            })}
          </div>
        </div>

        {/* Step Content */}
        <div className="w-full">
          {/* Step 1: API Key */}
            <div className={currentStep === 1 ? 'block' : 'hidden'}>
              <ComponentErrorBoundary name="ApiKeyInput">
                <ApiKeyInput
                  onApiKeyValidated={handleApiKeyValidated}
                  onLoadingChange={(loading) => setApiKeyStatus(loading ? 'loading' : null)}
                  autoTest={true}
                />
              </ComponentErrorBoundary>
            </div>

          {/* Step 2: Model Selection */}
          {hasApiKey && (
            <div className={currentStep === 2 ? 'block' : 'hidden'}>
              <ComponentErrorBoundary name="ModelSelector">
                <ModelSelector
                  selectedModel={selectedModel}
                  onModelSelect={handleModelSelected}
                  onLoadingChange={(loading) => setModelLoadStatus(loading ? 'loading' : null)}
                  onError={() => setModelLoadStatus('error')}
                />
              </ComponentErrorBoundary>
            </div>
          )}

          {/* Step 3: Prompt Input */}
          {hasModel && (
            <div className={currentStep === 3 ? 'block' : 'hidden'}>
              {isRegenerating && (
                <div className="mb-4 p-3 bg-primary/10 border border-primary/20 rounded-lg">
                  <div className="flex items-center gap-2 text-primary">
                    <MessageSquare className="h-4 w-4" />
                    <span className="text-sm font-medium">Regeneration Mode</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Edit your prompt or files below, then click Generate to create a new specification.
                  </p>
                </div>
              )}
              <ComponentErrorBoundary name="PromptInput">
                <PromptInput
                  prompt={prompt}
                  onPromptChange={setPrompt}
                  contextFiles={contextFiles}
                  onFilesChange={setContextFiles}
                />
              </ComponentErrorBoundary>
            </div>
          )}

          {/* Step 4: Generation/Results with Approval Workflow */}
          {currentStep === 4 && (
            <div className="w-full flex flex-col gap-4">
              {/* Workflow Guide */}
              <Card className="bg-primary/5 border-primary/20 mb-4">
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <FileText className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-sm mb-2">AI-Powered Specification Workflow</h4>
                      <p className="text-xs text-muted-foreground mb-3">
                        This workflow transforms your feature description into complete technical specifications through three progressive phases, each building on the previous.
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                        <div className="bg-background/50 p-3 rounded border">
                          <div className="font-medium text-primary mb-1">📋 Phase 1: Requirements</div>
                          <div className="text-muted-foreground">Analyzes your prompt to create structured user stories, acceptance criteria, and functional requirements following industry standards.</div>
                        </div>
                        <div className="bg-background/50 p-3 rounded border">
                          <div className="font-medium text-primary mb-1">🏗️ Phase 2: Technical Design</div>
                          <div className="text-muted-foreground">Transforms requirements into architectural decisions, component designs, data models, and technical specifications with diagrams.</div>
                        </div>
                        <div className="bg-background/50 p-3 rounded border">
                          <div className="font-medium text-primary mb-1">✅ Phase 3: Implementation Tasks</div>
                          <div className="text-muted-foreground">Breaks down the design into actionable development tasks with clear deliverables, priority, and requirement traceability.</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              {/* Top Panel: Current Phase Status */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between text-base">
                    <div className="flex items-center gap-2">
                      <Play className="h-4 w-4" />
                      {workflow.currentPhase === 'requirements' && 'Step 1: Requirements Generation'}
                      {workflow.currentPhase === 'design' && 'Step 2: Design Generation'}
                      {workflow.currentPhase === 'tasks' && 'Step 3: Tasks Generation'}
                      {workflow.currentPhase === 'complete' && 'Workflow Complete'}
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Phase-specific action buttons - only show if no content exists for current phase */}
                      {workflow.currentPhase !== 'complete' && !hasContentForCurrentPhase() && (
                        <>
                          <div className="flex flex-col items-end gap-2">
                            <Button 
                              onClick={() => {
                                workflow.clearError()
                                // Generate based on current phase
                                if (workflow.currentPhase === 'requirements') {
                                  const promptLines = prompt.trim().split('\n')
                                  const featureName = promptLines[0]?.replace(/^#+\s*/, '').trim() || 'Technical Specification'
                                  const textFiles = contextFiles.filter(file => 
                                    !file.type?.startsWith('image/') && 
                                    file.type !== 'image/png' && 
                                    file.type !== 'image/jpeg'
                                  )
                                  const workflowContextFiles = textFiles.map(file => ({
                                    id: file.id,
                                    name: file.name,
                                    type: file.type as any,
                                    content: file.content,
                                    size: file.size,
                                    lastModified: file.lastModified || Date.now(),
                                    mimeType: file.mimeType || 'text/plain'
                                  }))
                                  workflow.generateWithData(featureName, prompt, workflowContextFiles)
                                } else {
                                  // For design and tasks phases, use empty data since content comes from previous phases
                                  workflow.generateWithData('', '', [])
                                }
                              }} 
                              variant="default" 
                              size="sm"
                              disabled={workflow.isGenerating}
                              className="min-w-[160px]" 
                            >
                              <Play className="h-4 w-4 mr-2" />
                              {workflow.isGenerating ? (
                                <span className="flex items-center gap-2">
                                  Generating
                                  {workflow.state.timing[workflow.currentPhase]?.startTime && (
                                    <ElapsedTimer 
                                      startTime={workflow.state.timing[workflow.currentPhase].startTime}
                                      isRunning={workflow.isGenerating}
                                      className="text-xs text-primary-foreground"
                                      showIcon={false}
                                      compact={true}
                                    />
                                  )}
                                </span>
                              ) : (
                                `Generate ${workflow.currentPhase.charAt(0).toUpperCase() + workflow.currentPhase.slice(1)}`
                              )}
                            </Button>
                          </div>
                          
                          <Button 
                            onClick={handleBackToPrompt} 
                            variant="outline" 
                            size="sm"
                            disabled={workflow.isGenerating}
                          >
                            <MessageSquare className="h-4 w-4 mr-2" />
                            Edit Prompt
                          </Button>
                        </>
                      )}
                      
                      {/* Management buttons when content exists */}
                      {hasContentForCurrentPhase() && (
                        <Button 
                          onClick={handleBackToPrompt} 
                          variant="outline" 
                          size="sm"
                          disabled={workflow.isGenerating}
                          className="min-w-[180px]"
                        >
                          <MessageSquare className="h-4 w-4 mr-2" />
                          Edit Prompt & Regenerate
                        </Button>
                      )}
                    </div>
                  </CardTitle>
                </CardHeader>
                
                {/* Current Phase Content & Approval */}
                <CardContent>
                  {workflow.error && (
                    <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                      <div className="flex items-center gap-2 text-destructive mb-2">
                        <AlertCircle className="h-4 w-4" />
                        <span className="text-sm font-medium">Generation Error</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{workflow.error}</p>
                    </div>
                  )}
                  
                  {/* Phase content display with approval controls */}
                  {workflow.currentPhase === 'requirements' && (
                    <div className="space-y-4">
                      {workflow.error && (
                        <div className="bg-destructive/10 border border-destructive/20 p-4 rounded-lg">
                          <div className="flex items-center gap-2 text-destructive mb-2">
                            <AlertCircle className="h-4 w-4" />
                            <h4 className="font-semibold">Generation Failed</h4>
                          </div>
                          <p className="text-sm text-destructive/80">{workflow.error}</p>
                          <Button 
                            size="sm" 
                            variant="outline" 
                            onClick={() => workflow.clearError()}
                            className="mt-2"
                          >
                            Dismiss
                          </Button>
                        </div>
                      )}
                      {workflow.state.requirements && workflow.state.requirements.trim() && !workflow.error ? (
                        <>
                          {/* Approval Controls - MOVED TO TOP */}
                          <div className="border-b pb-4 mb-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <h4 className="font-semibold flex items-center gap-2">
                                  <CheckCircle className="h-4 w-4 text-green-500" />
                                  Requirements Generated - Review Required
                                </h4>
                                <p className="text-sm text-muted-foreground">Review the generated content below, then approve to proceed to Design phase</p>
                              </div>
                              <div className="flex items-center gap-3">
                                <Button
                                  variant="destructive"
                                  onClick={() => {
                                    workflow.rejectCurrentPhase()
                                    // Also clear the content for regeneration
                                    workflow.resetWorkflow()
                                  }}
                                  size="sm"
                                  className="min-w-[140px]"
                                >
                                  Reject & Clear Content
                                </Button>
                                <Button
                                  onClick={workflow.approveAndProceed}
                                  disabled={workflow.isGenerating}
                                  className="bg-green-600 hover:bg-green-700 min-w-[180px]"
                                  size="sm"
                                >
                                  {workflow.isGenerating ? (
                                    <span className="flex items-center gap-2">
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                      Generating Design
                                      {workflow.state.timing.design?.startTime && (
                                        <ElapsedTimer 
                                          startTime={workflow.state.timing.design.startTime}
                                          isRunning={workflow.isGenerating}
                                          className="text-xs text-primary-foreground"
                                          showIcon={false}
                                          compact={true}
                                        />
                                      )}
                                    </span>
                                  ) : (
                                    '✓ Approve & Continue to Design'
                                  )}
                                </Button>
                              </div>
                            </div>
                          </div>
                          
                          {/* Collapsible Content */}
                          <div className="bg-muted/50 rounded-lg">
                            <div className="flex items-center justify-between p-4 border-b border-muted">
                              <h4 className="font-semibold">Generated Requirements</h4>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setContentCollapsed(!contentCollapsed)}
                                className="text-xs"
                              >
                                {contentCollapsed ? 'Show Full Content' : 'Collapse to Preview'}
                              </Button>
                            </div>
                            <div className="p-4">
                              <div className="whitespace-pre-wrap text-sm">
                                {contentCollapsed 
                                  ? workflow.state.requirements.split('\n').slice(0, 5).join('\n') + 
                                    (workflow.state.requirements.split('\n').length > 5 ? '\n\n... (content collapsed, click "Show Full Content" above to expand)' : '')
                                  : workflow.state.requirements
                                }
                              </div>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="text-center py-16 text-muted-foreground min-h-[300px] flex flex-col justify-center">
                          <FileText className="h-8 w-8 mx-auto mb-4" />
                          <div className="font-medium mb-2">Ready to Generate Requirements</div>
                          <div className="text-sm mb-4 max-w-md mx-auto">
                            This is <strong>Step 1 of 3</strong>. Click "Generate Requirements" above to create technical requirements based on your prompt.
                          </div>
                          <div className="text-xs text-muted-foreground/70">
                            After generation, you'll review and approve before moving to Design phase.
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Similar blocks for Design and Tasks phases... */}
                  {workflow.currentPhase === 'design' && (
                    <div className="space-y-4">
                      {workflow.state.design && workflow.state.design.trim() ? (
                        <>
                          {/* Approval Controls - AT TOP */}
                          <div className="border-b pb-4 mb-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <h4 className="font-semibold flex items-center gap-2">
                                  <CheckCircle className="h-4 w-4 text-green-500" />
                                  Design Generated - Review Required
                                </h4>
                                <p className="text-sm text-muted-foreground">Review the generated design below, then approve to proceed to Tasks phase</p>
                              </div>
                              <div className="flex items-center gap-3">
                                <Button
                                  variant="destructive"
                                  onClick={() => {
                                    workflow.rejectCurrentPhase()
                                    workflow.resetWorkflow()
                                  }}
                                  size="sm"
                                  className="min-w-[140px]"
                                >
                                  Reject & Clear Content
                                </Button>
                                <Button
                                  onClick={workflow.approveAndProceed}
                                  disabled={workflow.isGenerating}
                                  className="bg-green-600 hover:bg-green-700 min-w-[180px]"
                                  size="sm"
                                >
                                  {workflow.isGenerating ? (
                                    <span className="flex items-center gap-2">
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                      Generating Tasks
                                      {workflow.state.timing.tasks?.startTime && (
                                        <ElapsedTimer 
                                          startTime={workflow.state.timing.tasks.startTime}
                                          isRunning={workflow.isGenerating}
                                          className="text-xs text-primary-foreground"
                                          showIcon={false}
                                          compact={true}
                                        />
                                      )}
                                    </span>
                                  ) : (
                                    '✓ Approve & Continue to Tasks'
                                  )}
                                </Button>
                              </div>
                            </div>
                          </div>
                          
                          {/* Collapsible Content */}
                          <div className="bg-muted/50 rounded-lg">
                            <div className="flex items-center justify-between p-4 border-b border-muted">
                              <h4 className="font-semibold">Generated Design</h4>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setContentCollapsed(!contentCollapsed)}
                                className="text-xs"
                              >
                                {contentCollapsed ? 'Show Full Content' : 'Collapse to Preview'}
                              </Button>
                            </div>
                            <div className="p-4">
                              <div className="whitespace-pre-wrap text-sm">
                                {contentCollapsed 
                                  ? workflow.state.design.split('\n').slice(0, 5).join('\n') + 
                                    (workflow.state.design.split('\n').length > 5 ? '\n\n... (content collapsed, click "Show Full Content" above to expand)' : '')
                                  : workflow.state.design
                                }
                              </div>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="text-center py-16 text-muted-foreground min-h-[300px] flex flex-col justify-center">
                          <Layers className="h-8 w-8 mx-auto mb-4" />
                          <div className="font-medium mb-2">Ready to Generate Design</div>
                          <div className="text-sm mb-4 max-w-md mx-auto">
                            This is <strong>Step 2 of 3</strong>. Click "Generate Design" above to create technical design based on approved requirements.
                          </div>
                          <div className="text-xs text-muted-foreground/70">
                            After generation, you'll review and approve before moving to Tasks phase.
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {workflow.currentPhase === 'tasks' && (
                    <div className="space-y-4">
                      {workflow.state.tasks && workflow.state.tasks.trim() ? (
                        <>
                          {/* Approval Controls - AT TOP */}
                          <div className="border-b pb-4 mb-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <h4 className="font-semibold flex items-center gap-2">
                                  <CheckCircle className="h-4 w-4 text-green-500" />
                                  Tasks Generated - Final Review Required
                                </h4>
                                <p className="text-sm text-muted-foreground">Review the implementation tasks below, then approve to complete the workflow</p>
                              </div>
                              <div className="flex items-center gap-3">
                                <Button
                                  variant="destructive"
                                  onClick={() => {
                                    workflow.rejectCurrentPhase()
                                    workflow.resetWorkflow()
                                  }}
                                  size="sm"
                                  className="min-w-[140px]"
                                >
                                  Reject & Clear Content
                                </Button>
                                <Button
                                  onClick={workflow.approveAndProceed}
                                  disabled={workflow.isGenerating}
                                  className="bg-blue-600 hover:bg-blue-700 min-w-[200px]"
                                  size="sm"
                                >
                                  {workflow.isGenerating ? (
                                    <span className="flex items-center gap-2">
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                      Completing Workflow
                                    </span>
                                  ) : (
                                    '✓ Approve & Complete Workflow'
                                  )}
                                </Button>
                              </div>
                            </div>
                          </div>
                          
                          {/* Collapsible Content */}
                          <div className="bg-muted/50 rounded-lg">
                            <div className="flex items-center justify-between p-4 border-b border-muted">
                              <h4 className="font-semibold">Generated Implementation Tasks</h4>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setContentCollapsed(!contentCollapsed)}
                                className="text-xs"
                              >
                                {contentCollapsed ? 'Show Full Content' : 'Collapse to Preview'}
                              </Button>
                            </div>
                            <div className="p-4">
                              <div className="whitespace-pre-wrap text-sm">
                                {contentCollapsed 
                                  ? workflow.state.tasks.split('\n').slice(0, 5).join('\n') + 
                                    (workflow.state.tasks.split('\n').length > 5 ? '\n\n... (content collapsed, click "Show Full Content" above to expand)' : '')
                                  : workflow.state.tasks
                                }
                              </div>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="text-center py-16 text-muted-foreground min-h-[300px] flex flex-col justify-center">
                          <List className="h-8 w-8 mx-auto mb-4" />
                          <div className="font-medium mb-2">Ready to Generate Tasks</div>
                          <div className="text-sm mb-4 max-w-md mx-auto">
                            This is <strong>Step 3 of 3</strong>. Click "Generate Tasks" above to create implementation tasks based on approved design.
                          </div>
                          <div className="text-xs text-muted-foreground/70">
                            After generation, you'll review and approve to complete the workflow.
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {workflow.currentPhase === 'complete' && (
                    <div className="space-y-6">
                      <div className="text-center border-b pb-6">
                        <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-600" />
                        <h3 className="text-2xl font-bold mb-2 text-green-700">Workflow Complete!</h3>
                        <p className="text-muted-foreground">Your technical specification has been generated successfully</p>
                      </div>
                      
                      {/* Summary Cards */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                        {/* Model & Settings Summary */}
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                              <div className="p-1 bg-primary/10 rounded">
                                🤖
                              </div>
                              Model & Configuration
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <div className="text-sm">
                              <div className="font-medium text-muted-foreground mb-1">AI Model Used</div>
                              <div className="bg-muted/50 p-2 rounded text-xs font-mono">
                                {selectedModel?.name || 'Default Model'}
                              </div>
                            </div>
                            <div className="text-sm">
                              <div className="font-medium text-muted-foreground mb-1">Feature Description</div>
                              <div className="bg-muted/50 p-2 rounded text-xs max-h-20 overflow-y-auto">
                                {prompt || 'No description provided'}
                              </div>
                            </div>
                            {contextFiles.length > 0 && (
                              <div className="text-sm">
                                <div className="font-medium text-muted-foreground mb-1">Context Files</div>
                                <div className="text-xs text-muted-foreground">
                                  {contextFiles.length} file{contextFiles.length !== 1 ? 's' : ''} provided
                                </div>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                        
                        {/* Performance Summary */}
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                              <div className="p-1 bg-green-100 rounded">
                                ⚡
                              </div>
                              Performance Summary
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            {['requirements', 'design', 'tasks'].map((phase) => {
                              const timing = workflow.state.timing?.[phase as keyof typeof workflow.state.timing]
                              const apiResponse = workflow.state.apiResponses?.[phase as keyof typeof workflow.state.apiResponses]
                              const hasContent = workflow.state[phase as keyof typeof workflow.state]
                              
                              // Debug logging to see what data we have
                              console.log(`[PerfSummary] ${phase}:`, { 
                                hasContent: !!hasContent, 
                                timing, 
                                apiResponse,
                                fullState: workflow.state 
                              })
                              
                              // Only show phases that have been completed
                              if (!hasContent) return null
                              
                              return (
                                <div key={phase} className="text-sm border-b pb-2 last:border-b-0">
                                  <div className="font-medium text-muted-foreground capitalize mb-1">{phase} Phase</div>
                                  <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div>
                                      <span className="text-muted-foreground">Time: </span>
                                      <span className="font-mono">{timing?.elapsed ? Math.round(timing.elapsed / 1000) : 0}s</span>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Tokens: </span>
                                      <span className="font-mono">{apiResponse?.tokens?.total?.toLocaleString() || '0'}</span>
                                    </div>
                                    {apiResponse?.cost && (
                                      <div className="col-span-2">
                                        <span className="text-muted-foreground">Cost: </span>
                                        <span className="font-mono">${apiResponse.cost.total.toFixed(4)}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                            
                            {/* Total Summary */}
                            <div className="text-sm pt-2 border-t font-medium">
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <span className="text-muted-foreground">Total Time: </span>
                                  <span className="font-mono text-primary">
                                    {Math.round(
                                      (['requirements', 'design', 'tasks'] as const).reduce((total, phase) => 
                                        total + (workflow.state.timing?.[phase]?.elapsed || 0), 0
                                      ) / 1000
                                    )}s
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Total Tokens: </span>
                                  <span className="font-mono text-primary">
                                    {(['requirements', 'design', 'tasks'] as const).reduce((total, phase) => 
                                      total + (workflow.state.apiResponses?.[phase]?.tokens?.total || 0), 0
                                    ).toLocaleString()}
                                  </span>
                                </div>
                                {(['requirements', 'design', 'tasks'] as const).some(phase => 
                                  workflow.state.apiResponses?.[phase]?.cost
                                ) && (
                                  <div className="col-span-2">
                                    <span className="text-muted-foreground">Total Cost: </span>
                                    <span className="font-mono text-primary">
                                      ${
                                        (['requirements', 'design', 'tasks'] as const).reduce((total, phase) => 
                                          total + (workflow.state.apiResponses?.[phase]?.cost?.total || 0), 0
                                        ).toFixed(4)
                                      }
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                      
                      {/* Generated Content Previews */}
                      <div className="space-y-4">
                        <h4 className="text-lg font-semibold">Generated Specifications</h4>
                        
                        {(['requirements', 'design', 'tasks'] as const).map((phase) => {
                          const content = workflow.state[phase]
                          if (!content) return null
                          
                          const isExpanded = expandedSpecs[phase] || false
                          const contentLines = content.split('\n')
                          const isLong = contentLines.length > 6
                          
                          return (
                            <Card key={phase}>
                              <CardHeader>
                                <CardTitle className="text-base capitalize flex items-center justify-between">
                                  <span>{phase} Specification</span>
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="text-xs">
                                      {content.length.toLocaleString()} characters
                                    </Badge>
                                    {isLong && (
                                      <Button 
                                        variant="ghost" 
                                        size="sm"
                                        onClick={() => setExpandedSpecs(prev => ({...prev, [phase]: !isExpanded}))}
                                        className="text-xs h-6 px-2"
                                      >
                                        {isExpanded ? 'Collapse' : 'Expand'}
                                      </Button>
                                    )}
                                  </div>
                                </CardTitle>
                              </CardHeader>
                              <CardContent>
                                <div className={`bg-muted/30 rounded p-3 text-sm font-mono whitespace-pre-wrap overflow-y-auto ${isExpanded ? 'max-h-96' : 'max-h-32'}`}>
                                  {isExpanded ? content : (
                                    contentLines.slice(0, 6).join('\n') + 
                                    (isLong ? '\n\n...(click Expand to view full content)' : '')
                                  )}
                                </div>
                              </CardContent>
                            </Card>
                          )
                        })}
                      </div>
                      
                      {/* Debug: Add dummy data for testing */}
                      {process.env.NODE_ENV === 'development' && (
                        <div className="text-center py-4">
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => {
                              // Populate dummy performance data for testing
                              const dummyTiming = {
                                requirements: { startTime: Date.now() - 15000, endTime: Date.now() - 10000, elapsed: 5000 },
                                design: { startTime: Date.now() - 8000, endTime: Date.now() - 3000, elapsed: 5000 },
                                tasks: { startTime: Date.now() - 2000, endTime: Date.now(), elapsed: 2000 }
                              }
                              const dummyApiResponses = {
                                requirements: { model: 'test-model', tokens: { prompt: 1500, completion: 800, total: 2300 }, cost: { prompt: 0.0045, completion: 0.012, total: 0.0165 }, duration: 5000, timestamp: Date.now() - 10000 },
                                design: { model: 'test-model', tokens: { prompt: 2200, completion: 1200, total: 3400 }, cost: { prompt: 0.0066, completion: 0.018, total: 0.0246 }, duration: 5000, timestamp: Date.now() - 3000 },
                                tasks: { model: 'test-model', tokens: { prompt: 1800, completion: 600, total: 2400 }, cost: { prompt: 0.0054, completion: 0.009, total: 0.0144 }, duration: 2000, timestamp: Date.now() }
                              }
                              
                              // Update workflow state with dummy data using available methods
                              // Note: This is a development-only hack to test the UI
                              workflow.updatePhaseContent('requirements', 'Dummy requirements content for testing...');
                              workflow.updatePhaseContent('design', 'Dummy design content for testing...');
                              workflow.updatePhaseContent('tasks', 'Dummy tasks content for testing...');
                              workflow.setCurrentPhase('complete');
                              
                              // Force a state update with performance data
                              // Note: This directly modifies localStorage for testing
                              const currentState = JSON.parse(localStorage.getItem('openspec-workflow-state') || '{}');
                              const updatedState = {
                                ...currentState,
                                phase: 'complete',
                                requirements: 'Dummy requirements content for testing...',
                                design: 'Dummy design content for testing...',
                                tasks: 'Dummy tasks content for testing...',
                                timing: dummyTiming,
                                apiResponses: dummyApiResponses
                              };
                              localStorage.setItem('openspec-workflow-state', JSON.stringify(updatedState));
                              
                              // Force a page reload to pick up the new data
                              window.location.reload();
                            }}
                            className="text-xs"
                          >
                            🧪 Add Test Performance Data
                          </Button>
                        </div>
                      )}
                      
                      {/* Action Buttons */}
                      <div className="flex items-center justify-center gap-4 pt-6 border-t">
                        <Button
                          onClick={async () => {
                            try {
                              // Extract feature name from prompt
                              const promptLines = prompt.trim().split('\n')
                              const featureName = promptLines[0]?.replace(/^#+\s*/, '').trim() || 'Technical Specification'
                              
                              // Prepare data for ZIP export
                              const specData = {
                                featureName,
                                requirements: workflow.state.requirements || '',
                                design: workflow.state.design || '',
                                tasks: workflow.state.tasks || '',
                                modelName: selectedModel?.name || 'Unknown Model',
                                timing: {
                                  requirements: workflow.state.timing?.requirements,
                                  design: workflow.state.timing?.design,
                                  tasks: workflow.state.timing?.tasks
                                },
                                tokens: {
                                  requirements: workflow.state.apiResponses?.requirements?.tokens?.total,
                                  design: workflow.state.apiResponses?.design?.tokens?.total,
                                  tasks: workflow.state.apiResponses?.tasks?.tokens?.total
                                }
                              }
                              
                              // Create and download ZIP file
                              const zipBlob = await createSpecificationZip(specData)
                              downloadZipFile(zipBlob, featureName, workflow.state.tasks)
                              
                            } catch (error) {
                              console.error('Export failed:', error)
                              // Fallback to simple JSON export if ZIP fails
                              const data = {
                                requirements: workflow.phaseContent.requirements,
                                design: workflow.phaseContent.design,
                                tasks: workflow.phaseContent.tasks,
                                exportedAt: new Date().toISOString()
                              }
                              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                              const url = URL.createObjectURL(blob)
                              const a = document.createElement('a')
                              a.href = url
                              a.download = 'specification-fallback.json'
                              a.click()
                              URL.revokeObjectURL(url)
                            }
                          }}
                          className="min-w-[180px] flex items-center gap-2"
                        >
                          <Download className="h-4 w-4" />
                          Download Specification Package
                        </Button>
                        
                        <Button 
                          variant="outline"
                          onClick={handleStartNewProject}
                          className="min-w-[150px]"
                        >
                          Start New Project
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* Export Dialog - Removed for simplification */}

      {/* Regenerate Confirmation Dialog */}
      <Dialog open={showRegenerateConfirm} onOpenChange={setShowRegenerateConfirm}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              Start Over?
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              <div className="space-y-3">
                <p>This will clear your current specification and let you create a new one.</p>
                <p className="text-sm">
                  You'll be able to edit your prompt and files before generating again.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button 
              variant="outline" 
              onClick={handleCancelRegenerate}
              className="border-border text-foreground hover:bg-muted"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleConfirmRegenerate}
              className="bg-primary hover:bg-primary/80 text-primary-foreground"
            >
              Yes, Start Over
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Continue/Start Over Dialog */}
      <Dialog open={showContinueDialog} onOpenChange={setShowContinueDialog}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Welcome back!</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              We found some saved information from your previous session:
              <div className="mt-3 space-y-1">
                {hasApiKey && <div className="text-green-400 text-sm flex items-center gap-2">✓ API Key saved and validated</div>}
                {selectedModel && <div className="text-green-400 text-sm flex items-center gap-2">✓ AI Model: {selectedModel.name}</div>}
                {prompt.trim() && <div className="text-green-400 text-sm flex items-center gap-2">✓ Prompt saved ({prompt.length} characters)</div>}
                {contextFiles.length > 0 && <div className="text-green-400 text-sm flex items-center gap-2">✓ Context files: {contextFiles.length} file{contextFiles.length !== 1 ? 's' : ''}</div>}
              </div>
              <div className="mt-3 text-sm">
                <strong>Continue</strong> will restore all your saved data, or <strong>Reset & Start Fresh</strong> will clear everything and begin anew.
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button 
              variant="outline" 
              onClick={handleResetAndStartFresh}
              className="border-border text-foreground hover:bg-muted"
            >
              Reset & Start Fresh
            </Button>
            <Button 
              onClick={handleContinue}
              className="bg-primary hover:bg-primary/80 text-primary-foreground"
            >
              Continue Where I Left Off
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
