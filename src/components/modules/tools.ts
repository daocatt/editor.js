import Paragraph from '../../tools/paragraph/dist/bundle';
import Module from '../__module';
import * as _ from '../utils';
import {
  EditorConfig,
  Tool,
  ToolConstructable,
  ToolSettings
} from '../../../types';
import BoldInlineTool from '../inline-tools/inline-tool-bold';
import ItalicInlineTool from '../inline-tools/inline-tool-italic';
import LinkInlineTool from '../inline-tools/inline-tool-link';
import Stub from '../../tools/stub';
import ToolsFactory from '../tools/factory';
import InlineTool from '../tools/inline';
import BlockTool from '../tools/block';
import BlockTune from '../tools/tune';
import BaseTool from '../tools/base';
import Stub from '../tools/stub';
import EventsDispatcher from '../utils/events';

/**
 * @module Editor.js Tools Submodule
 *
 * Creates Instances from Plugins and binds external config to the instances
 */

type ToolClass = BlockTool | InlineTool | BlockTune;

/**
 * Class properties:
 *
 * @typedef {Tools} Tools
 * @property {Tools[]} toolsAvailable - available Tools
 * @property {Tools[]} toolsUnavailable - unavailable Tools
 * @property {object} toolsClasses - all classes
 * @property {object} toolsSettings - Tools settings
 * @property {EditorConfig} config - Editor config
 */
export default class Tools extends Module {
  /**
   * Name of Stub Tool
   * Stub Tool is used to substitute unavailable block Tools and store their data
   *
   * @type {string}
   */
  public stubTool = 'stub';

  /**
   * Returns available Tools
   *
   * @returns {object<Tool>}
   */
  public get available(): Map<string, ToolClass> {
    return this.toolsAvailable;
  }

  /**
   * Returns unavailable Tools
   *
   * @returns {Tool[]}
   */
  public get unavailable(): Map<string, ToolClass> {
    return this.toolsUnavailable;
  }

  /**
   * Return Tools for the Inline Toolbar
   *
   * @returns {object} - object of Inline Tool's classes
   */
  public get inline(): Map<string, InlineTool> {
    if (this._inlineTools) {
      return this._inlineTools;
    }

    const tools = Array
      .from(this.available.entries())
      .filter(([name, tool]: [string, BaseTool<any>]) => {
        if (tool.type !== ToolType.Inline) {
          return false;
        }
        /**
         * Some Tools validation
         */
        const inlineToolRequiredMethods = ['render', 'surround', 'checkState'];
        const notImplementedMethods = inlineToolRequiredMethods.filter((method) => !tool.instance()[method]);

        if (notImplementedMethods.length) {
          _.log(
            `Incorrect Inline Tool: ${tool.name}. Some of required methods is not implemented %o`,
            'warn',
            notImplementedMethods
          );

          return false;
        }

        return true;
      });

    /**
     * Cache prepared Tools
     */
    this._inlineTools = new Map(tools) as Map<string, InlineTool>;

    return this._inlineTools;
  }

  /**
   * Return editor block tools
   */
  public get block(): Map<string, BlockTool> {
    if (this._blockTools) {
      return this._blockTools;
    }

    const tools = Array
      .from(this.available.entries())
      .filter(([, tool]) => {
        return tool.type === ToolType.Block;
      });

    this._blockTools = new Map(tools) as Map<string, BlockTool>;

    return this._blockTools;
  }

  /**
   * Returns default Tool object
   */
  public get defaultTool(): BlockTool {
    return this.block.get(this.config.defaultBlock);
  }

  /**
   * Tools objects factory
   */
  private factory: ToolsFactory;

  /**
   * Tools` classes available to use
   */
  private readonly toolsAvailable: Map<string, ToolClass> = new Map();

  /**
   * Tools` classes not available to use because of preparation failure
   */
  private readonly toolsUnavailable: Map<string, ToolClass> = new Map();

  /**
   * Cache for the prepared inline tools
   *
   * @type {null|object}
   * @private
   */
  private _inlineTools: Map<string, InlineTool> = null;

  /**
   * Cache for the prepared block tools
   */
  private _blockTools: Map<string, BlockTool> = null;

  /**
   * Returns internal tools
   *
   * @param type - if passed, Tools will be filtered by type
   */
  public getInternal(type?: ToolType): Map<string, ToolClass> {
    let tools = Array
      .from(this.available.entries())
      .filter(([, tool]) => {
        return tool.isInternal;
      });

    if (type) {
      tools = tools.filter(([, tool]) => tool.type === type);
    }

    return new Map(tools);
  }

  /**
   * Creates instances via passed or default configuration
   *
   * @returns {Promise<void>}
   */
  public prepare(): Promise<void> {
    this.validateTools();

    /**
     * Assign internal tools
     */
    this.config.tools = _.deepMerge({}, this.internalTools, this.config.tools);

    if (!Object.prototype.hasOwnProperty.call(this.config, 'tools') || Object.keys(this.config.tools).length === 0) {
      throw Error('Can\'t start without tools');
    }

    const config = this.prepareConfig();

    this.factory = new ToolsFactory(config, this.config, this.Editor.API);

    /**
     * getting classes that has prepare method
     */
    const sequenceData = this.getListOfPrepareFunctions(config);

    /**
     * if sequence data contains nothing then resolve current chain and run other module prepare
     */
    if (sequenceData.length === 0) {
      return Promise.resolve();
    }

    /**
     * to see how it works {@link '../utils.ts#sequence'}
     */
    return _.sequence(sequenceData, (data: { toolName: string }) => {
      this.success(data);
    }, (data: { toolName: string }) => {
      this.fallback(data);
    });
  }

  /**
   * Returns internal tools
   * Includes Bold, Italic, Link and Paragraph
   */
  public get internalTools(): { [toolName: string]: ToolConstructable | ToolSettings & { isInternal?: boolean } } {
    return {
      bold: {
        class: BoldInlineTool,
        isInternal: true,
      },
      italic: {
        class: ItalicInlineTool,
        isInternal: true,
      },
      link: {
        class: LinkInlineTool,
        isInternal: true,
      },
      paragraph: {
        class: Paragraph,
        inlineToolbar: true,
        isInternal: true,
      },
      stub: {
        class: Stub,
        isInternal: true,
      },
    };
  }

  /**
   * Calls each Tool reset method to clean up anything set by Tool
   */
  public destroy(): void {
    Object.values(this.available).forEach(async tool => {
      if (_.isFunction(tool.reset)) {
        await tool.reset();
      }
    });
  }

  /**
   * Success callback
   *
   * @param {object} data - append tool to available list
   */
  private success(data: { toolName: string }): void {
    this.toolsAvailable.set(data.toolName, this.factory.get(data.toolName));
  }

  /**
   * Fail callback
   *
   * @param {object} data - append tool to unavailable list
   */
  private fallback(data: { toolName: string }): void {
    this.toolsUnavailable.set(data.toolName, this.factory.get(data.toolName));
  }

  /**
   * Binds prepare function of plugins with user or default config
   *
   * @returns {Array} list of functions that needs to be fired sequentially
   * @param config - tools config
   */
  private getListOfPrepareFunctions(config: {[name: string]: ToolSettings}): {
    function: (data: { toolName: string }) => void | Promise<void>;
    data: { toolName: string };
  }[] {
    const toolPreparationList: {
      function: (data: { toolName: string }) => void | Promise<void>;
      data: { toolName: string };
    }[] = [];

    Object
      .entries(config)
      .forEach(([toolName, settings]) => {
        toolPreparationList.push({
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          function: _.isFunction(settings.class.prepare) ? settings.class.prepare : (): void => {},
          data: {
            toolName,
          },
        });
      });

    return toolPreparationList;
  }

  /**
   * Validate Tools configuration objects and throw Error for user if it is invalid
   */
  private validateTools(): void {
    /**
     * Check Tools for a class containing
     */
    for (const toolName in this.config.tools) {
      if (Object.prototype.hasOwnProperty.call(this.config.tools, toolName)) {
        if (toolName in this.internalTools) {
          return;
        }

        const tool = this.config.tools[toolName];

        if (!_.isFunction(tool) && !_.isFunction((tool as ToolSettings).class)) {
          throw Error(
            `Tool «${toolName}» must be a constructor function or an object with function in the «class» property`
          );
        }
      }
    }
  }

  /**
   * Unify tools config
   */
  private prepareConfig(): {[name: string]: ToolSettings} {
    const config: {[name: string]: ToolSettings} = {};

    /**
     * Save Tools settings to a map
     */
    for (const toolName in this.config.tools) {
      /**
       * If Tool is an object not a Tool's class then
       * save class and settings separately
       */
      if (_.isObject(this.config.tools[toolName])) {
        config[toolName] = this.config.tools[toolName] as ToolSettings;
      } else {
        config[toolName] = { class: this.config.tools[toolName] as ToolConstructable };
      }
    }

    return config;
  }
}

/**
 * What kind of plugins developers can create
 */
export enum ToolType {
  /**
   * Block tool
   */
  Block,
  /**
   * Inline tool
   */
  Inline,

  /**
   * Block tune
   */
  Tune,
}
