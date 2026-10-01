import type {Furniture,Point} from './index';

/** Beside the town square, clear of every current resident/watch patrol. Root
 * appends this prop and collider before creating the immutable navigation map. */
export const FOREST_STORY_BOARD_USE:Point={x:102.4,y:43.5};
export const FOREST_STORY_BOARD:Furniture={
  id:'bramblewick-story-board',kind:'board',
  footprint:{x:101,y:41,width:2.8,height:2.2},
  collider:{x:101.2,y:42.5,width:2.4,height:.35},
  usePoints:[FOREST_STORY_BOARD_USE],seats:[],
};

export const FOREST_STORY_BOARD_LABEL='Bramblewick noticeboard';
