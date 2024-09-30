import { ICompletions, IParams, AIRequestType, RemoteBackendOPModel } from "../../types/types";
import { GenerationParams, CompletionParams, InsertionParams } from "../../types/models";
import { buildSolgptPromt } from "../../prompts/promptBuilder";
import EventEmitter from "events";
import { ChatHistory } from "../../prompts/chat";
import axios, { AxiosResponse } from 'axios';
import { Readable } from 'stream';

const defaultErrorMessage = `Unable to get a response from AI server`

export class RemoteInferencer implements ICompletions {
  api_url: string
  completion_url: string
  max_history = 7
  model_op = RemoteBackendOPModel.CODELLAMA // default model operation change this to llama if necessary
  event: EventEmitter
  test_env=true

  constructor(apiUrl?:string, completionUrl?:string) {
    this.api_url = apiUrl!==undefined ? apiUrl: this.test_env? "http://127.0.0.1:7861/" : "https://solcoder.remixproject.org"
    this.completion_url = completionUrl!==undefined ? completionUrl : this.test_env? "http://127.0.0.1:7861/" : "https://completion.remixproject.org"
    this.event = new EventEmitter()
  }

  private async _makeRequest(endpoint, payload, rType:AIRequestType){
    this.event.emit("onInference")
    let requesURL = rType === AIRequestType.COMPLETION ? this.completion_url : this.api_url
    const userPrompt = payload.prompt

    console.log(requesURL)
    try {
      const options = { headers: { 'Content-Type': 'application/json', } }
      const result = await axios.post(`${requesURL}/${endpoint}`, payload, options)

      switch (rType) {
      case AIRequestType.COMPLETION:
        if (result.statusText === "OK")
          return result.data.generatedText
        else {
          return defaultErrorMessage
        }
      case AIRequestType.GENERAL:
        if (result.statusText === "OK") {
          const resultText = result.data.generatedText
          ChatHistory.pushHistory(userPrompt, resultText)
          return resultText
        } else {
          return defaultErrorMessage
        }
      }

    } catch (e) {
      ChatHistory.clearHistory()
      console.error('Error making request to Inference server:', e.message)
    }
    finally {
      this.event.emit("onInferenceDone")
    }
  }

  private async _streamInferenceRequest(endpoint, payload, rType:AIRequestType){
    let resultText = ""
    try {
      this.event.emit('onInference')
      const requestURL = rType === AIRequestType.COMPLETION ? this.completion_url : this.api_url
      const userPrompt = payload.prompt
      const response:AxiosResponse<Readable> = await axios({
        method: 'post',
        url: `${requestURL}/${endpoint}`,
        data: payload,
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
        }
        , responseType: 'blob' });

      response.data.on('data', (chunk: Buffer) => {
        try {
          const parsedData = JSON.parse(chunk.toString());
          if (parsedData.isGenerating) {
            this.event.emit('onStreamResult', parsedData.generatedText);
            resultText = resultText + parsedData.generatedText
            console.log("resultText" + resultText)
          } else {
            // stream generation is complete
            resultText = resultText + parsedData.generatedText
            ChatHistory.pushHistory(userPrompt, resultText)
            return parsedData.generatedText
          }
        } catch (error) {
          console.error('Error parsing JSON:', error);
          ChatHistory.clearHistory()
        }
      });

      return "" // return empty string for now as handled in event
    } catch (error) {
      ChatHistory.clearHistory()
      console.error('Error making stream request to Inference server:', error.message);
    }
    finally {
      console.log("end streamin" + resultText)
      this.event.emit('onInferenceDone')
    }
  }

  async code_completion(prompt, options:IParams=CompletionParams): Promise<any> {
    const payload = { prompt, "endpoint":"code_completion", ...options }
    if (options.stream_result) return this._streamInferenceRequest(payload.endpoint, payload, AIRequestType.COMPLETION) 
    else return this._makeRequest(payload.endpoint, payload, AIRequestType.COMPLETION)
  }

  async code_insertion(msg_pfx, msg_sfx, options:IParams=InsertionParams): Promise<any> {
    // const payload = { "data":[msg_pfx, "code_insertion", msg_sfx, 1024, 0.5, 0.92, 50]}
    const payload = { prompt, "endpoint":"code_insertion", msg_pfx, msg_sfx, ...options }
    if (options.stream_result) return this._streamInferenceRequest(payload.endpoint, payload, AIRequestType.COMPLETION) 
    else return this._makeRequest(payload.endpoint, payload, AIRequestType.COMPLETION)
  }

  async code_generation(prompt, options:IParams=GenerationParams): Promise<any> {
    // const payload = { "data":[prompt, "code_completion", "", false,1000,0.9,0.92,50]}
    const payload = { prompt, "endpoint":"code_completion", ...options }
    if (options.stream_result) return this._streamInferenceRequest(payload.endpoint, payload, AIRequestType.COMPLETION) 
    else return this._makeRequest(payload.endpoint, payload, AIRequestType.COMPLETION)
  }

  async solidity_answer(prompt, options:IParams=GenerationParams): Promise<any> {
    const main_prompt = buildSolgptPromt(prompt, this.model_op)
    // const payload = { "data":[main_prompt, "solidity_answer", false,2000,0.9,0.8,50]}
    const payload = { prompt, "endpoint":"solidity_answer", ...options }
    if (options.stream_result) return this._streamInferenceRequest(payload.endpoint, payload, AIRequestType.GENERAL) 
    else return this._makeRequest(payload.endpoint, payload, AIRequestType.GENERAL)
  }

  async code_explaining(prompt, context:string="", options:IParams=GenerationParams): Promise<any> {
    // const payload = { "data":[prompt, "code_explaining", false,2000,0.9,0.8,50, context]}
    const payload = { prompt, "endpoint":"code_explaining", context, ...options }
    if (options.stream_result) return this._streamInferenceRequest(payload.endpoint, payload, AIRequestType.GENERAL) 
    else return this._makeRequest(payload.endpoint, payload, AIRequestType.GENERAL)
  }

  async error_explaining(prompt, options:IParams=GenerationParams): Promise<any> {
    const payload = { prompt, "endpoint":"error_explaining", ...options }
    if (options.stream_result) return this._streamInferenceRequest(payload.endpoint, payload  , AIRequestType.GENERAL) 
    else return this._makeRequest(payload.endpoint, payload, AIRequestType.GENERAL)
  }
}
